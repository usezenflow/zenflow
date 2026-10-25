import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  FileText,
  GraduationCap,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import {
  buildToday,
  deriveState,
  SESSION_TONE_CLASSES,
  sessionTone,
  type TodayItem,
  type TodayView,
} from "@zenflow/core";
import type { Session, SessionType } from "@zenflow/shared";
import { listSessions, startSession } from "@/api/tasks";
import { EmptyMark } from "@/components/brand/state-marks";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useUserStore } from "@/hooks/use-user-store";
import { filterHidden } from "@/lib/hidden-sessions";
import { t } from "@/lib/i18n";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { zonedDate } from "@/utils/tz";
import { format } from "date-fns";

const TYPE_ICON: Record<SessionType, typeof BookOpen> = {
  LECTURE: BookOpen,
  ASSIGNMENT: FileText,
  EXAM: GraduationCap,
  TASK: Sparkles,
  DND: CalendarClock,
};

const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: "Lecture",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  TASK: "Study",
  DND: "Busy",
};

function untilLabel(start: Date, now: Date): string {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000 / 5) * 5;
  if (minutes <= 0) return t("Now");
  if (minutes < 60) return t("In {minutes} min", { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t("In {hours} h", { hours })
    : t("In {hours} h {minutes} min", { hours, minutes: rest });
}

function Hourly({ items, tz }: { items: TodayItem[]; tz: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex min-w-0 gap-2 overflow-x-auto" aria-label={t("Later today")}>
      {items.map((item) => {
        const Icon = TYPE_ICON[item.type];
        return (
          <li
            key={item.id}
            className="flex w-24 shrink-0 flex-col gap-1 rounded-2xl bg-white/50 px-3 py-2 dark:bg-white/10"
          >
            <span className="text-xs tabular-nums opacity-70">
              {format(zonedDate(item.start, tz), "HH:mm")}
            </span>
            <Icon className="size-4" aria-hidden />
            <span className="truncate text-xs font-medium">{item.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Floating pill showing what's up next. Tap to expand into a card.
 * Lives in a portal so it floats above the calendar grid.
 */
export function TodayCard() {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listSessions("day", new Date());
      setSessions(filterHidden(data.sessions));
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Could not load today")));
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("zenflow:calendar-refresh", refresh);
    return () => window.removeEventListener("zenflow:calendar-refresh", refresh);
  }, [load]);

  // Close expanded card when clicking outside
  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  if (!sessions) return null;

  const view: TodayView = buildToday(sessions, now, tz);
  const next = view.next;

  if (!next) {
    return (
      <div
        ref={cardRef}
        className={cn(
          "fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4",
          "glass-panel rounded-2xl border border-border shadow-xl",
          "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
        )}
      >
        <section className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm opacity-80">{t("Today")}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{t("Nothing left today")}</p>
          </div>
          <EmptyMark size={64} />
        </section>
      </div>
    );
  }

  const tone = SESSION_TONE_CLASSES[sessionTone(deriveState({ type: next.type }))];
  const Icon = TYPE_ICON[next.type];
  const started = next.start.getTime() <= now.getTime();

  async function start() {
    if (!next) return;
    setBusy(true);
    try {
      await startSession(next.id);
      window.dispatchEvent(new CustomEvent("zenflow:calendar-refresh"));
      toast.success(t("Session started"), { icon: "calendar-check" });
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Could not start this session")));
    } finally {
      setBusy(false);
    }
  }

  const pillContent = (
    <div className="flex items-center gap-3 w-full">
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
          tone.badge,
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {t(started ? "On now" : "Up next")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">{next.title}</p>
        <p className="truncate text-xs opacity-70">
          {t("{start} to {end}", {
            start: format(zonedDate(next.start, tz), "HH:mm"),
            end: format(zonedDate(next.end, tz), "HH:mm"),
          })}
        </p>
      </div>
      <span className="text-sm font-medium tabular-nums opacity-80 shrink-0">
        {untilLabel(next.start, now)}
      </span>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label={t("Expand")}
      >
        <ChevronDown className="size-4" />
      </button>
    </div>
  );

  const cardContent = (
    <div
      ref={cardRef}
      className={cn(
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4",
        "glass-panel rounded-2xl border border-border shadow-xl",
        expanded
          ? "animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
          : "animate-out fade-out-0 slide-out-to-bottom-2 duration-150",
      )}
    >
      <section className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                tone.badge,
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {t(started ? "On now" : "Up next")}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold tracking-tight">{next.title}</p>
              <p className="text-sm opacity-70">{t(TYPE_LABEL[next.type])}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium tabular-nums opacity-80 shrink-0">
              {untilLabel(next.start, now)}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t("Close")}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-1 text-sm tabular-nums opacity-80">
          {t("{start} to {end}", {
            start: format(zonedDate(next.start, tz), "HH:mm"),
            end: format(zonedDate(next.end, tz), "HH:mm"),
          })}
        </div>

        {view.later.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <p className="mb-2 text-xs font-medium opacity-60">{t("Later today")}</p>
            <Hourly items={view.later} tz={tz} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={busy}
            onClick={start}
          >
            <Play className="size-4" aria-hidden />
            {t(started ? "Mark started" : "Start")}
          </Button>
        </div>
      </section>
    </div>
  );

  return expanded ? cardContent : pillContent;
}