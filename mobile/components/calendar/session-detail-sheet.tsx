import {
  confirmPlacement,
  createSession,
  getSessionDetails,
  markSessionDone,
  clearSessionDone,
  removeSession,
  removeSessionSeries,
  truncateSessionSeries,
  undoPlacement,
} from "@/api/tasks";
import { MakeRoomSheet, type MakeRoomSheetHandle } from "@/components/calendar/make-room-sheet";
import { SessionTypeBadge } from "@/components/calendar/session-type-badge";
import { SessionEditor } from "@/components/calendar/session-editor";
import {
  type DeleteRecurringScope,
  DeleteRecurringSheet,
  type DeleteRecurringSheetHandle,
} from "@/components/tasks/delete-recurring-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { type SessionFormValues, getSeriesKind, zonedDate } from "@zenflow/core";
import type { CreateSessionInput, InfeasiblePolicy, PlacementPlan, Session, SessionDetailResponse } from "@zenflow/shared";
import { useToast } from "@/components/ui/toast";
import { showDisplacedToast, showErrorToast, showSplitToast, placementToastMessage, withInfeasibleRetry } from "@/lib/task-toasts";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetScrollView,
  ScreenSheetProvider,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useUserStore } from "@/hooks/use-user-store";
import { format, t } from "@/lib/i18n";
import { DURATION } from "@/lib/motion";
import { durationLabel } from "@/lib/duration-label";
import { cn } from "@/lib/utils";
import { hideSessions } from "@/lib/hidden-sessions";
import { getPlacementPlan } from "@/lib/make-room";
import { showMovedToast } from "@/lib/move-toast";
import { isSyncedSession } from "@/lib/synced-session";
import { offerPrepReschedule } from "@/lib/prep-toast";
import { notifySessionsMutated, subscribeToSessionMutations } from "@/lib/session-cache";
import { rememberPlacement } from "@/lib/slot-alternatives";
import { warmLandingDay } from "@/lib/warm-day";
import { deferCommit, UNDO_WINDOW_MS } from "@/lib/undo";
import { SESSION_DETAIL_SNAP_POINTS } from "@/lib/session-detail";
import { BookOpen, Check, ChevronRight, Clock, Plus, Trash2 } from "@/components/Icons";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { GLASS_HIT_SIZE, GLASS_SIZE, GlassButton } from "@/components/ui/glass-button";
import { useOffline } from "@/hooks/use-offline";
import { forwardRef, startTransition, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

export interface SessionDetailSheetHandle {
  open: (session: Session) => void;
  /** Opens a plan that is not placed yet. Its fields are editable until it is scheduled. */
  openDraft: (prefill?: { title?: string; deadline?: string }) => void;
}

interface SessionDetailSheetProps {
  tz: string;
  /** A save or placement moved the session. The calendar teleports to the new start and pulses it. */
  onMoved?: (session: Session, startISO: string) => void;
}

const DRAFT_DURATION = 60;
const PREP_TARGETS = new Set<Session["type"]>(["LECTURE", "EXAM", "ASSIGNMENT"]);
const PREPARE_DURATION = 60;

const SKELETON_ROWS = [0, 1, 2];

/** Detail rows while the body renders: an icon slot, then two lines. */
function DetailSkeleton() {
  return (
    <View testID="session-detail-skeleton" className="gap-4 px-5 pb-4 pt-2">
      {SKELETON_ROWS.map((i) => (
        <View key={i} className="flex-row items-start gap-3">
          <Skeleton className="h-5 w-5 rounded-full" />
          <View className="flex-1 gap-1.5">
            <Skeleton className={i === 0 ? "h-4 w-3/5" : "h-4 w-2/5"} />
            <Skeleton className="h-3 w-1/3" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The session sheet. It opens on a saved session (every field editable in
 * place, see `SessionEditor`) or on a draft from the navbar's `+`, which
 * schedules once its title and length are set. Pin and delete sit at the
 * bottom of a saved session.
 */
export const SessionDetailSheet = forwardRef<SessionDetailSheetHandle, SessionDetailSheetProps>(({ tz, onMoved }, ref) => {
  useLanguage();
  const sheet = useBottomSheet();
  const { toast } = useToast();
  const user = useUserStore((s) => s.user);
  const offline = useOffline();
  const deleteScopeSheet = useRef<DeleteRecurringSheetHandle>(null);
  const makeRoom = useRef<MakeRoomSheetHandle>(null);
  const [session, setSession] = useState<(Session & { done?: boolean }) | null>(null);
  const [draft, setDraft] = useState<{
    title: string;
    deadline: string;
  } | null>(null);
  // The header paints with the sheet; the rows follow once it has painted.
  const [bodyReady, setBodyReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preps, setPreps] = useState<Session[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [doneBusy, setDoneBusy] = useState(false);
  const placeRef = useRef<(() => void) | null>(null);
  // For a prep plan: the lecture, exam or assignment it prepares for.
  const [target, setTarget] = useState<Session | null>(null);
  const showSkeleton = useDelayedLoading(!bodyReady);

  // A sync or another device may change the open session (e.g. an assignment
  // checked off from LMS); refetch it so the sheet follows live.
  const openId = session?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    return subscribeToSessionMutations(() => {
      void getSessionDetails(openId)
        .then(({ prepSessions, prepTarget, nextPrepOccurrenceStart: _n, ...fresh }) => {
          setSession((cur) => (cur?.id === openId ? fresh : cur));
          setPreps(prepSessions);
          setTarget(prepTarget);
        })
        .catch(() => undefined);
    });
  }, [openId]);

  const openSession = useCallback(
    (next: Session) => {
      setSession(next);
      setDraft(null);
      setPreps([]);
      setTarget(null);
      setJustSaved(false);
      if (PREP_TARGETS.has(next.type) || next.prepForSessionId)
        void getSessionDetails(next.id)
          .then((detail) => {
            setPreps(detail.prepSessions);
            setTarget(detail.prepTarget);
          })
          .catch(() => undefined);
      setBodyReady(false);
      sheet.open();
      requestAnimationFrame(() => startTransition(() => setBodyReady(true)));
    },
    [sheet],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: openSession,
      openDraft: (prefill = {}) => {
        setSession(null);
        setPreps([]);
        setTarget(null);
        setJustSaved(false);
        setDraft({
          title: prefill.title ?? "",
          deadline: prefill.deadline ?? "",
        });
        setBodyReady(true);
        sheet.open();
      },
    }),
    [sheet, openSession],
  );

  const onSaved = (updated: Session) => {
    const moved = updated.scheduledStartTime !== session?.scheduledStartTime;
    if (moved && updated.scheduledStartTime) void offerPrepReschedule(toast, updated, updated.scheduledStartTime, tz);
    setSession(updated);
    if (moved && updated.scheduledStartTime) onMoved?.(updated, updated.scheduledStartTime);
  };

  // Schedules a draft. The sheet turns into the saved session in place, so
  // the fields stay where they are. A plan that cannot fit opens Make room.
  const placeDraft = async (values: SessionFormValues) => {
    if (!user) return;
    const input = (policy?: InfeasiblePolicy): CreateSessionInput =>
      ({
        type: "TASK",
        title: values.title,
        note: null,
        location: values.location?.trim() || null,
        locationLat: values.location?.trim() ? (values.locationLat ?? null) : null,
        locationLng: values.location?.trim() ? (values.locationLng ?? null) : null,
        originLocation: values.originLocation?.trim() || null,
        originLat: values.originLocation?.trim() ? (values.originLat ?? null) : null,
        originLng: values.originLocation?.trim() ? (values.originLng ?? null) : null,
        commuteMinutes: values.originLocation?.trim() && values.location?.trim() ? (values.commuteMinutes ?? null) : null,
        tags: [],
        reminders: values.reminders ?? [],
        durationMinutes: values.duration ?? DRAFT_DURATION,
        deadline: values.deadline as string,
        ...(policy ? { infeasiblePolicy: policy } : {}),
      }) as CreateSessionInput;
    const create = (policy?: InfeasiblePolicy) => createSession(input(policy) as Parameters<typeof createSession>[0]);

    const handleCreated = async (response: Awaited<ReturnType<typeof createSession>>) => {
      rememberPlacement(response);
      if (response.scheduledStartTime) await warmLandingDay(response.scheduledStartTime, tz);
      showDisplacedToast(toast, response.displacedSessions);
      const { message, variant } = placementToastMessage(response, user);
      showSplitToast(toast, message, variant, response.scheduledStartTime ? "calendar-check" : "calendar-plus");
      setSession(response);
      setDraft(null);
      if (response.scheduledStartTime) onMoved?.(response, response.scheduledStartTime);
    };

    const openMakeRoom = async (plan: PlacementPlan) => {
      const moved = await Promise.all(plan.moves.map((move) => getSessionDetails(move.id).catch(() => null)));
      const createLate = async () => {
        try {
          await handleCreated(await create("ACCEPT_LATE_DEADLINE"));
        } catch (error) {
          const again = getPlacementPlan(error);
          if (again) return openMakeRoom(again);
          showErrorToast(toast, error, t("Couldn't create the session"), "calendar-x");
        }
      };
      makeRoom.current?.open({
        subtitle: t("{title} needs a time. These sessions move to fit it.", {
          title: values.title,
        }),
        plan,
        title: values.title,
        durationMinutes: values.duration ?? DRAFT_DURATION,
        sessions: moved.filter((s): s is NonNullable<typeof s> => s !== null),
        actions: [
          {
            id: "move",
            label: t("Move it"),
            run: async () => {
              try {
                const confirmed = await confirmPlacement(plan.id);
                if (confirmed.session.scheduledStartTime) {
                  showMovedToast(toast, {
                    to: zonedDate(confirmed.session.scheduledStartTime, tz),
                    withTime: true,
                    onUndo: () =>
                      void undoPlacement(confirmed.undoGroupId)
                        .then(() => notifySessionsMutated())
                        .catch((error) => showErrorToast(toast, error, t("Couldn't move this session"), "calendar-x")),
                  });
                }
                await handleCreated({
                  ...confirmed.session,
                  displacedSessions: confirmed.displacedSessions,
                  undoGroupId: confirmed.undoGroupId,
                  slotProposalId: null,
                  primarySlot: null,
                  alternativeSlot: null,
                  divergent: false,
                });
              } catch (error) {
                showErrorToast(toast, error, t("The plan changed. Try again."), "calendar-x");
              }
            },
          },
          {
            id: "late",
            label: t("Keep mine and accept late"),
            variant: "outline",
            run: createLate,
          },
          {
            id: "pick",
            label: t("Pick another time"),
            variant: "ghost",
            run: () => {},
          },
        ],
      });
    };

    await withInfeasibleRetry(
      toast,
      (policy) => create(policy),
      handleCreated,
      (error) => {
        const plan = getPlacementPlan(error);
        if (plan) {
          void openMakeRoom(plan);
          return;
        }
        showErrorToast(toast, error, t("Couldn't create the session"), "calendar-x");
      },
    );
  };

  // Books a study session before a lecture in one tap: no form, no
  // confirmation. A slot that needs other sessions moved is not taken.
  const prepare = async () => {
    const start = session?.scheduledStartTime;
    if (!session || !start || !user || preparing) return;
    setPreparing(true);
    try {
      const response = await createSession({
        type: "TASK",
        title: t("Prepare for {title}", { title: session.title }),
        note: null,
        location: null,
        tags: [],
        reminders: user.defaultReminderMinutes != null ? [user.defaultReminderMinutes] : [],
        durationMinutes: PREPARE_DURATION,
        deadline: start,
        prepForSessionId: session.id,
      } as Parameters<typeof createSession>[0]);
      rememberPlacement(response);
      setPreps((prev) => [...prev, response]);
      if (response.scheduledStartTime) await warmLandingDay(response.scheduledStartTime, tz);
      const { message } = placementToastMessage(response, user);
      toast({
        title: message,
        icon: "calendar-check",
        duration: UNDO_WINDOW_MS,
        action: {
          label: t("Undo"),
          onPress: () =>
            void (response.undoGroupId ? undoPlacement(response.undoGroupId) : removeSession(response.id))
              .then(() => notifySessionsMutated())
              .catch((error) => showErrorToast(toast, error, t("Couldn't undo"), "calendar-x")),
        },
      });
      if (response.scheduledStartTime) onMoved?.(response, response.scheduledStartTime);
      sheet.close();
    } catch (error) {
      if (getPlacementPlan(error)) {
        toast({ title: t("No free time before this"), icon: "calendar-x" });
      } else {
        showErrorToast(toast, error, t("Couldn't create the session"), "calendar-x");
      }
    } finally {
      setPreparing(false);
    }
  };

  // The block goes at once; nothing is sent until the undo window closes,
  // and Undo cancels the send and brings the block back.
  function runDelete(scope: DeleteRecurringScope) {
    if (!session) return;
    const target = session;
    const seriesKind = getSeriesKind(target);
    const commit = async () => {
      try {
        if (scope === "series" && target.seriesId) {
          await removeSessionSeries(target.seriesId);
        } else if (scope === "following" && target.seriesId && seriesKind === "recurring" && target.scheduledStartTime) {
          await truncateSessionSeries(target.seriesId, target.scheduledStartTime);
        } else {
          await removeSession(target.id);
        }
      } catch (error) {
        unhide();
        showErrorToast(toast, error, t("Couldn't delete session"), "trash");
      }
    };
    const unhide = hideSessions(
      scope === "series" && target.seriesId
        ? { seriesId: target.seriesId }
        : scope === "following" && target.seriesId && target.scheduledStartTime
          ? { seriesId: target.seriesId, fromISO: target.scheduledStartTime }
          : { id: target.id },
    );
    const cancelCommit = deferCommit(commit, UNDO_WINDOW_MS);
    toast({
      title:
        scope === "series"
          ? t("Series deleted")
          : scope === "following"
            ? t("This and later occurrences removed")
            : t("Session deleted"),
      icon: "trash",
      duration: UNDO_WINDOW_MS,
      action: {
        label: t("Undo"),
        onPress: () => {
          cancelCommit();
          unhide();
        },
      },
    });
    sheet.close();
  }

  function onDelete() {
    if (!session) return;
    if (getSeriesKind(session) === "none") {
      runDelete("occurrence");
      return;
    }
    const occurrenceDate = session.scheduledStartTime ? zonedDate(session.scheduledStartTime, tz) : new Date();
    deleteScopeSheet.current?.open(occurrenceDate);
  }

  async function toggleDone() {
    const current = session;
    if (!current || doneBusy) return;
    const next = !current.done;
    if (next && current.scheduledStartTime && Date.now() < new Date(current.scheduledStartTime).getTime()) {
      showErrorToast(toast, null, t("Mark done once it's started"), "calendar-x");
      return;
    }
    setDoneBusy(true);
    try {
      const res = next ? await markSessionDone(current.id) : await clearSessionDone(current.id);
      setSession((s) => (s ? { ...s, done: res.done } : s));
    } catch (error) {
      showErrorToast(toast, error, t("Couldn't update this session"), "calendar-x");
    } finally {
      setDoneBusy(false);
    }
  }

  // Hosted in the screen's own view, not the overlay window: the photo and
  // file pickers the note editor opens present above the screen, and would
  // sit behind an overlay sheet.
  return (
    <ScreenSheetProvider>
      <BottomSheet>
        <BottomSheetContent ref={sheet.ref} snapPoints={SESSION_DETAIL_SNAP_POINTS} enableDynamicSizing={false}>
          {(session || draft) && (
            <>
              <BottomSheetHeader className="items-start gap-3 border-b-0 px-5 pb-3">
                <View className="min-h-10 min-w-0 flex-1 justify-center gap-1.5">
                  {session ? (
                    <View className="flex-row flex-wrap items-center gap-2.5">
                      <SessionTypeBadge type={session.type} size="lg" />
                    </View>
                  ) : (
                    <Text testID="session-detail-draft" className="text-[17px] font-bold tracking-tight">
                      {t("New plan")}
                    </Text>
                  )}
                </View>
                <View className="flex-row items-center gap-2">
                  {justSaved && (
                    <Animated.View
                      entering={FadeIn.duration(DURATION.base)}
                      exiting={FadeOut.duration(DURATION.base)}
                      testID="session.saved"
                      className="h-8 flex-row items-center gap-1.5 self-center rounded-full bg-brand-lime px-3"
                    >
                      <Check size={13} className="text-card" />
                      <Text className="text-[12px] font-semibold text-card">{t("Saved")}</Text>
                    </Animated.View>
                  )}
                  {!session && (
                    <Pressable
                      testID="session.place"
                      accessibilityRole="button"
                      accessibilityLabel={t("Schedule it")}
                      accessibilityState={{ disabled: offline || placing, busy: placing }}
                      disabled={offline || placing}
                      onPress={() => placeRef.current?.()}
                      style={({ pressed }) => ({
                        minWidth: GLASS_HIT_SIZE,
                        minHeight: GLASS_HIT_SIZE,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: offline || placing ? 0.4 : pressed ? 0.8 : 1,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      })}
                    >
                      <View
                        className="items-center justify-center bg-primary"
                        style={{
                          width: GLASS_SIZE,
                          height: GLASS_SIZE,
                          borderRadius: GLASS_SIZE / 2,
                        }}
                      >
                        <BusyOr busy={placing} size={18} tone="onPrimary"><Plus size={20} className="text-primary-foreground" /></BusyOr>
                      </View>
                    </Pressable>
                  )}
                  {session && !offline && !isSyncedSession(session) && (
                    <GlassButton
                      testID="session.delete"
                      onPress={onDelete}
                      icon={Trash2}
                      destructive
                      accessibilityLabel={t("Delete session")}
                    />
                  )}
                  {session && session.scheduledStartTime && !offline && !isSyncedSession(session) && (
                    <Pressable
                      testID="session.mark-done"
                      accessibilityRole="button"
                      accessibilityLabel={session?.done ? t("Mark undone") : t("Mark done")}
                      accessibilityState={{ selected: session.done }}
                      disabled={doneBusy || !!(session.scheduledStartTime && Date.now() < new Date(session.scheduledStartTime).getTime())}
                      onPress={toggleDone}
                      style={({ pressed }) => ({
                        minWidth: GLASS_HIT_SIZE,
                        minHeight: GLASS_HIT_SIZE,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: doneBusy ? 0.4 : pressed ? 0.8 : 1,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      })}
                    >
                      <View
                        className={cn(
                          "items-center justify-center",
                          session?.done && "bg-brand-lime",
                        )}
                        style={{
                          width: GLASS_SIZE,
                          height: GLASS_SIZE,
                          borderRadius: GLASS_SIZE / 2,
                          borderWidth: session?.done ? 0 : StyleSheet.hairlineWidth,
                          borderColor: session?.done ? undefined : "rgba(0, 0, 0, 0.12)",
                        }}
                      >
                        {session?.done ? (
                          <Check size={14} className="text-card" />
                        ) : (
                          <Check size={14} className="text-muted-foreground" />
                        )}
                      </View>
                    </Pressable>
                  )}
                </View>
              </BottomSheetHeader>

              {!bodyReady || showSkeleton ? (
                <DetailSkeleton />
              ) : (
                <BottomSheetScrollView
                  contentContainerStyle={{ paddingBottom: 40 }}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {session && (
                    <View className="gap-3 px-5 pb-2 pt-1">
                      {target && (
                        <Pressable
                          testID="session-detail-prep-target"
                          onPress={() => openSession(target)}
                          accessibilityRole="button"
                          accessibilityLabel={target.title}
                          className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 active:opacity-70"
                        >
                          <SessionTypeBadge type={target.type} size="md" />
                          <View className="min-w-0 flex-1 gap-0.5">
                            <Text className="text-[12px] text-muted-foreground">{t("Preparing for")}</Text>
                            <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
                              {target.title}
                            </Text>
                            {target.scheduledStartTime && (
                              <View className="flex-row items-center gap-1.5">
                                <Clock size={13} className="text-muted-foreground" />
                                <Text className="text-[13px] text-muted-foreground">
                                  {format(zonedDate(target.scheduledStartTime, tz), "EEE, MMM d, HH:mm")}
                                </Text>
                              </View>
                            )}
                          </View>
                          <ChevronRight size={18} className="text-muted-foreground" />
                        </Pressable>
                      )}
                      {PREP_TARGETS.has(session.type) &&
                        session.scheduledStartTime &&
                        new Date(session.scheduledStartTime).getTime() > Date.now() &&
                        !session.skipped &&
                        preps.length === 0 && (
                          <Pressable
                            testID="session-detail-prepare"
                            onPress={() => void prepare()}
                            disabled={preparing}
                            accessibilityRole="button"
                            accessibilityLabel={t("Prepare in advance")}
                            className="h-11 flex-row items-center gap-2 rounded-full bg-primary/10 px-3 active:opacity-70"
                          >
                            <Plus size={18} className="text-primary" />
                            <Text className="text-[15px] font-semibold text-primary">{t("Prepare in advance")}</Text>
                          </Pressable>
                        )}
                      {preps.length > 0 && (
                          preps.map((prep) => {
                            return (
                              <View
                                key={prep.id}
                                testID={`session-detail-prep-${prep.id}`}
                                accessibilityLabel={prep.title}
                                className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3"
                              >
                                <View
                                  className={cn(
                                    "h-10 w-10 items-center justify-center rounded-xl",
                                    "bg-primary/10",
                                  )}
                                >
                                  <BookOpen size={18} className="text-primary" />
                                </View>
                                <View className="min-w-0 flex-1 gap-0.5">
                                  <Text
                                    numberOfLines={1}
                                    className="text-[15px] font-semibold text-foreground"
                                  >
                                    {prep.title}
                                  </Text>
                                  {prep.scheduledStartTime && (
                                    <View className="flex-row items-center gap-1.5">
                                      <Clock size={13} className="text-muted-foreground" />
                                      <Text className="text-[13px] text-muted-foreground">
                                        {format(zonedDate(prep.scheduledStartTime, tz), "EEE, MMM d, HH:mm")}
                                      </Text>
                                      <View className="rounded-full bg-muted px-2 py-0.5">
                                        <Text className="text-[11px] font-medium text-muted-foreground">
                                          {durationLabel(prep.durationMinutes)}
                                        </Text>
                                      </View>
                                    </View>
                                  )}
                                </View>
                              </View>
                            );
                          })
                      )}
                    </View>
                  )}
                  <SessionEditor
                    key={session?.id ?? "draft"}
                    session={session}
                    draft={draft ?? undefined}
                    tz={tz}
                    onSaved={onSaved}
                    onSavedChange={setJustSaved}
                    onPlace={placeDraft}
                    placeRef={placeRef}
                    onPlacingChange={setPlacing}
                  />
                </BottomSheetScrollView>
              )}
            </>
          )}
        </BottomSheetContent>
      </BottomSheet>
      <DeleteRecurringSheet
        ref={deleteScopeSheet}
        onChoose={runDelete}
      />
      <MakeRoomSheet ref={makeRoom} tz={tz} />
    </ScreenSheetProvider>
  );
});

SessionDetailSheet.displayName = "SessionDetailSheet";
