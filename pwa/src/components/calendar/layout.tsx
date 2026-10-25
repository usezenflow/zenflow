import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Event, Session, ViewMode } from "@zenflow/shared";
import { CalendarHeader } from "./header";
import { OfflineBanner } from "./offline-banner";
import { CalendarLoadError } from "./load-error";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { recordBlockStarts } from "@/lib/block-start";
import { DayView } from "./day-view";
import { TodayCard } from "./today-card";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { CalendarSidebar, SidebarBody } from "./sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { SessionSheetTarget } from "./session-detail-sheet";

const SessionDetailSheet = lazy(() =>
  import("./session-detail-sheet").then((m) => ({ default: m.SessionDetailSheet })),
);
const SettingsDialog = lazy(() =>
  import("@/components/settings/settings-dialog").then((m) => ({ default: m.SettingsDialog })),
);
import { MakeRoomSheet, openPlacementPlan } from "./make-room-sheet";
import { ViewSkeleton } from "./view-skeleton";
import { InsightsSheet } from "./insights-sheet";
import { WeekStrip } from "./week-strip";
import { useIsPhone } from "@/hooks/use-is-phone";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { useWeekDayBars } from "@/hooks/use-week-day-types";
import { usePlanOffers } from "@/components/notifications/use-plan-offers";
import { filterHidden, useHiddenVersion } from "@/lib/hidden-sessions";
import { getPlacementPlan } from "@/lib/make-room";
import { showMovedCountToast, showMovedToast, showResizedToast } from "@/lib/move-toast";
import { useHighlightStore } from "@/hooks/use-highlight-store";
import { undoMove } from "@/lib/move-undo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarCheck } from "lucide-react";
import { listSessions, resolveConflicts, undoPlacement, updateSession } from "@/api/tasks";
import { tasksToBlocks } from "@zenflow/core";
import { zonedDate } from "@/utils/tz";
import { isAxiosError } from "axios";
import {
  apiErrorMessage,
  errorToast,
  notifyDisplaced,
  withInfeasibleRetry,
} from "@/lib/toast";
import { LateSessionsContext } from "./late-context";
import { useUserStore } from "@/hooks/use-user-store";
import { useConnectivity } from "@/lib/connectivity";
import { cacheKey, readCalendar, writeCalendar } from "@/lib/offline/cache";
import { warmCalendar } from "@/lib/offline/warm-calendar";
import { t } from "@/lib/i18n";
import { toast } from "@/lib/notify";
import { zonedNow } from "@/utils/tz";
import { addDays, format, isValid } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { useSlideDirection } from "@/hooks/use-slide-direction";

const VALID_VIEWS: ViewMode[] = ["day", "week", "month"];
const DATE_PARAM_FORMAT = "yyyy-MM-dd";

/**
 * Parse a `YYYY-MM-DD` string as the user's wall-clock midnight in their
 * IANA timezone, returning a Date whose local fields match the given date.
 * Returns `null` when the string is missing or invalid.
 */
function parseDateParam(dateStr: string | null, tz: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const utc = fromZonedTime(dateStr + "T12:00:00", tz);
  if (!isValid(utc)) return null;
  return toZonedTime(utc, tz);
}

export function CalendarLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const [date, setDate] = useState<Date>(() => {
    const resolved = useUserStore.getState().user?.timezone || "UTC";
    return (
      parseDateParam(searchParams.get("date"), resolved) ?? zonedNow(resolved)
    );
  });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const raw = searchParams.get("view");
    return VALID_VIEWS.includes(raw as ViewMode) ? (raw as ViewMode) : "day";
  });

  useEffect(() => {
    setSearchParams(
      { view: viewMode, date: format(date, DATE_PARAM_FORMAT) },
      { replace: true },
    );
  }, [date, viewMode, setSearchParams]);

  useViewShortcuts(viewMode, setViewMode, setDate);
  const daySlide = useSlideDirection(date.getTime());

  const [blocks, setBlocks] = useState<Event[]>([]);
  // Phones show Day and Month; the week strip above the day view replaces Week there.
  // Desktop shows Week and Month: the week grid already shows a day in full.
  const phone = useIsPhone();
  const dayBars = useWeekDayBars(date, tz, true);
  useEffect(() => {
    if (phone && viewMode === "week") setViewMode("day");
    if (!phone && viewMode === "day") setViewMode("week");
  }, [phone, viewMode]);
  const [lateIds, setLateIds] = useState<Set<string>>(() => new Set());
  const [sheet, setSheet] = useState<SessionSheetTarget | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `?focus=dlu` (a link from the finish-setup flow) opens settings on the LMS section.
  const [focusLms] = useState(() => searchParams.get("focus") === "dlu");
  useEffect(() => {
    if (focusLms) setSettingsOpen(true);
  }, [focusLms]);
  // The sheets load on first open, so the calendar's first paint does not wait for them.
  const settingsMounted = useRef(false);
  if (settingsOpen) settingsMounted.current = true;
  const sheetMounted = useRef(false);
  if (sheet) sheetMounted.current = true;

  function openDraft() {
    setSheet({ kind: "draft" });
    setNavOpen(false);
  }
  const userId = useUserStore((s) => s.user?.id);
  const online = useConnectivity((s) => s.online);
  // Saved data is on screen because the last fetch failed.
  const [stale, setStale] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Tracks an in-flight load so mutations can wait for it before PATCHing a
  // session id the server may have just dropped.
  const inFlight = useRef<Promise<Event[]> | null>(null);
  // The sessions as the server last returned them: the "before" of a move, and
  // the source the hidden filter rebuilds the blocks from.
  const sessionsRef = useRef<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const showSkeleton = useDelayedLoading(!loaded && !loadFailed);
  const hiddenVersion = useHiddenVersion();

  useEffect(() => {
    setBlocks(tasksToBlocks(filterHidden(sessionsRef.current)));
  }, [hiddenVersion]);

  usePlanOffers(tz);

  async function refetch(): Promise<Event[]> {
    const key = cacheKey(viewMode, date);
    const show = (sessions: Session[]) => {
      sessionsRef.current = sessions;
      recordBlockStarts(sessions);
      setLoaded(true);
      setLateIds(new Set(sessions.filter((s) => s.late).map((s) => s.id)));
      const next = tasksToBlocks(filterHidden(sessions));
      setBlocks(next);
      return next;
    };
    const load = (async () => {
      // Paint saved data at once, then revalidate with the network.
      const saved = userId ? await readCalendar(userId, key) : undefined;
      if (saved) show(saved.sessions);
      try {
        const data = await listSessions(viewMode, date);
        if (userId) void writeCalendar(userId, key, data.sessions);
        setStale(false);
        setLoadFailed(false);
        return show(data.sessions);
      } catch (error) {
        if (!saved) throw error;
        setStale(true);
        return show(saved.sessions);
      }
    })();
    inFlight.current = load;
    try {
      return await load;
    } catch {
      setLoadFailed(true);
      return [];
    } finally {
      if (inFlight.current === load) inFlight.current = null;
    }
  }

  // A block that starts while the calendar is open is caught by the minute tick.
  useEffect(() => {
    const check = () => recordBlockStarts(sessionsRef.current);
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // Keep the next days and months readable offline, and refresh on reconnect.
  useEffect(() => {
    if (!userId) return;
    const reconnect = () => {
      void warmCalendar(userId);
      window.dispatchEvent(new CustomEvent("zenflow:calendar-refresh"));
    };
    void warmCalendar(userId);
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, [userId]);

  useEffect(() => {
    const handler = () => {
      refetch();
    };
    window.addEventListener("zenflow:calendar-refresh", handler);
    return () =>
      window.removeEventListener("zenflow:calendar-refresh", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, viewMode]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, viewMode]);

  // Warm the days either side, so a day switch paints from the cache.
  useEffect(() => {
    if (!userId || !online || viewMode !== "day") return;
    for (const offset of [-1, 1]) {
      const target = addDays(date, offset);
      void listSessions("day", target)
        .then((res) => writeCalendar(userId, cacheKey("day", target), res.sessions))
        .catch(() => undefined);
    }
  }, [date, viewMode, userId, online]);

  // Fetch the sheet chunks while the calendar is idle, so the first open does not lag.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void import("./session-detail-sheet");
      void import("@/components/settings/settings-dialog");
    }, 1500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      setSheet({ kind: "session", sessionId: (e as CustomEvent).detail as string });
      setNavOpen(false);
    };
    window.addEventListener("zenflow:open-task", handler as EventListener);
    return () =>
      window.removeEventListener("zenflow:open-task", handler as EventListener);
  }, []);

  // Holding a conflicting block repacks the sessions around it. The held block stays put.
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      const sessionId = (e as CustomEvent<string>).detail;
      resolveConflicts(sessionId)
        .then((res) => {
          if (res.moved.length === 0) {
            toast.info(t("Nothing to move"));
            return;
          }
          window.dispatchEvent(
            new CustomEvent("zenflow:task-updated", { detail: sessionId }),
          );
          useHighlightStore.getState().setHighlight(sessionId);
          const groupId = res.undoGroupId;
          showMovedCountToast({
            count: res.moved.length,
            late: res.lateSessionIds.length,
            onUndo: groupId
              ? () =>
                  void undoPlacement(groupId)
                    .then(() => refetch())
                    .catch(() => errorToast(t("Couldn't undo")))
              : undefined,
          });
          void refetch();
        })
        .catch((error) =>
          errorToast(
            isAxiosError(error) && error.response?.status === 409
              ? t("No layout fits these sessions")
              : t("Couldn't resolve this overlap"),
          ),
        );
    };
    window.addEventListener("zenflow:resolve-conflicts", handler as EventListener);
    return () =>
      window.removeEventListener("zenflow:resolve-conflicts", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => {
      setSettingsOpen(true);
      setNavOpen(false);
    };
    window.addEventListener("zenflow:open-settings", handler);
    return () => window.removeEventListener("zenflow:open-settings", handler);
  }, []);

  // Jump the calendar to a `YYYY-MM-DD` day — used by the notification inbox to
  // land on the start of an ingested term's timetable.
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      const target = parseDateParam((e as CustomEvent).detail as string, tz);
      if (!target) return;
      setDate(target);
      setNavOpen(false);
    };
    window.addEventListener("zenflow:goto-date", handler as EventListener);
    return () =>
      window.removeEventListener("zenflow:goto-date", handler as EventListener);
  }, [tz]);

  /** Commit a start/duration change as a plain session PATCH. */
  async function commitMove(
    taskId: string,
    patch: { scheduledStartTime: string; durationMinutes?: number },
    kind: "move" | "resize" = "move",
  ) {
    if (inFlight.current) {
      const fresh = await inFlight.current;
      if (!fresh.some((b) => b.taskId === taskId)) return;
    }
    const before = sessionsRef.current.find((s) => s.id === taskId);

    try {
      const res = await withInfeasibleRetry((infeasiblePolicy) =>
        updateSession(
          taskId,
          infeasiblePolicy ? { ...patch, infeasiblePolicy } : patch,
        ),
      );
      if (!res) return; // dismissed; finally{} snaps the block back
      notifyDisplaced(res);
      if (res.skippedSessionIds?.length) {
        errorToast(t("Some sessions weren't moved"), {
          description: t("{count} sessions stayed put because the new time conflicted.", {
            count: res.skippedSessionIds.length,
          }),
        });
      }
      window.dispatchEvent(
        new CustomEvent("zenflow:task-updated", { detail: taskId }),
      );
      if (before) {
        const onUndo = () =>
          void undoMove(res, before)
            .then(() => refetch())
            .catch(() => errorToast(t("Couldn't undo")));
        if (kind === "resize") {
          showResizedToast({ minutes: patch.durationMinutes ?? before.durationMinutes, onUndo });
        } else {
          showMovedToast({ to: zonedDate(patch.scheduledStartTime, tz), withTime: true, onUndo });
        }
      }
    } catch (error) {
      const plan = getPlacementPlan(error);
      if (plan) {
        const title = before?.title ?? "";
        void openPlacementPlan({
          plan,
          subtitle: t("{title} moves to this time. These sessions move to fit it.", { title }),
          title,
          durationMinutes: patch.durationMinutes ?? before?.durationMinutes ?? 60,
          onConfirmed: (res) => {
            notifyDisplaced(res);
            window.dispatchEvent(new CustomEvent("zenflow:task-updated", { detail: taskId }));
          },
          onUndone: () => void refetch(),
        });
        return;
      }
      if (isAxiosError(error))
        errorToast(t("Couldn't reschedule"), {
          description: apiErrorMessage(
            error,
            t("The session is back where it was. Try a different time."),
          ),
        });
    } finally {
      await refetch();
    }
  }

  async function onReschedule(taskId: string, startISO: string) {
    await commitMove(taskId, { scheduledStartTime: startISO });
  }

  async function onResize(
    taskId: string,
    startISO: string,
    durationMinutes: number,
  ) {
    // Optimistic: reflect the new size immediately; refetch() reconciles after.
    setBlocks((bs) =>
      bs.map((b) =>
        b.taskId === taskId
          ? {
              ...b,
              start: startISO,
              end: new Date(
                new Date(startISO).getTime() + durationMinutes * 60_000,
              ).toISOString(),
            }
          : b,
      ),
    );
    await commitMove(taskId, {
      scheduledStartTime: startISO,
      durationMinutes,
    }, "resize");
  }

  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      const { taskId, startISO, durationMinutes } = (e as CustomEvent).detail;
      onResizeRef.current(taskId, startISO, durationMinutes);
    };
    window.addEventListener("zenflow:resize-task", handler as EventListener);
    return () =>
      window.removeEventListener(
        "zenflow:resize-task",
        handler as EventListener,
      );
  }, []);

  return (
    <LateSessionsContext.Provider value={lateIds}>
      <div className="flex h-dvh overflow-hidden">
        <CalendarSidebar />

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent
            side="left"
            className="w-full sm:w-72 bg-sidebar p-0 lg:hidden"
          >
            <SheetTitle className="sr-only">{t("Navigation")}</SheetTitle>
            <SidebarBody />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <CalendarHeader
            date={date}
            setDate={setDate}
            currentView={viewMode}
            setCurrentView={setViewMode}
            onOpenNav={() => setNavOpen(true)}
            onNew={openDraft}
          />
          {(!online || stale) && !loadFailed && <OfflineBanner />}
          {viewMode === "day" && (
            <WeekStrip
              focusedDate={date}
              today={zonedNow(tz)}
              bars={dayBars}
              onSelectDay={setDate}
              onShiftWeek={(direction) => setDate((d) => addDays(d, direction * 7))}
            />
          )}
          <div className="relative min-h-0 flex-1">
            <Button
              variant="outline"
              size="default"
              onClick={() => setDate(zonedNow(tz))}
              className={cn(
                "absolute sm:hidden left-1/2 bottom-8 z-30 -translate-x-1/2",
                "rounded-full border-border/60 bg-background/80 backdrop-blur-sm shadow-lg",
              )}
            >
              <CalendarCheck className="size-4" />
              {t("Today")}
            </Button>

            {/* Floating TodayCard pill — always rendered, floats above grid */}
            <TodayCard />

            {/* Absolute fill, not h-full: a flex child's percentage height is unreliable
                in Safari, and the page must never scroll instead of this box. */}
            <div
              data-scroll-container
              className="absolute inset-0 overflow-auto overscroll-contain"
              style={{ "--week-cells-height": "64px" } as React.CSSProperties}
            >
              {viewMode === "day" && (
                <div
                  key={daySlide.position}
                  className={daySlide.direction === "next" ? "animate-day-in-next" : "animate-day-in-prev"}
                >
                  <DayView
                    events={blocks}
                    date={date}
                    setEvents={setBlocks}
                    onReschedule={onReschedule}
                  />
                </div>
              )}
              {viewMode !== "day" && (
                <div key={viewMode} className="h-full animate-in fade-in duration-200">
                  {viewMode === "week" && (
                    <WeekView
                      events={blocks}
                      date={date}
                      setEvents={setBlocks}
                      onReschedule={onReschedule}
                    />
                  )}
                  {viewMode === "month" && (
                    <MonthView
                      events={blocks}
                      date={date}
                      onOpenDay={(d) => {
                        setDate(d);
                        setViewMode("day");
                      }}
                      setEvents={setBlocks}
                      onReschedule={onReschedule}
                    />
                  )}
                </div>
              )}
            </div>
            <div
              className={cn(
                "absolute inset-0 z-10 bg-background transition-[opacity,visibility] duration-200",
                !showSkeleton && "invisible pointer-events-none opacity-0",
              )}
            >
              <ViewSkeleton view={viewMode} />
            </div>
            <div
              className={cn(
                "absolute inset-0 z-20 bg-background transition-[opacity,visibility] duration-200",
                !loadFailed && "invisible pointer-events-none opacity-0",
              )}
            >
              <CalendarLoadError onRetry={() => void refetch()} />
            </div>
          </div>
        </div>
        {sheetMounted.current && (
          <Suspense fallback={null}>
            <SessionDetailSheet
              target={sheet}
              onClose={() => setSheet(null)}
              onChanged={refetch}
              setDate={setDate}
            />
          </Suspense>
        )}
        {settingsMounted.current && (
          <Suspense fallback={null}>
            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} focusLms={focusLms} />
          </Suspense>
        )}
        <MakeRoomSheet />
        <InsightsSheet />
      </div>
    </LateSessionsContext.Provider>
  );
}
