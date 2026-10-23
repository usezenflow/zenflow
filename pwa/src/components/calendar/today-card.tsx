import { useCallback, useEffect, useState } from "react";
import { BookOpen, CalendarClock, FileText, GraduationCap, Play, Sparkles } from "lucide-react";
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

/** Shown as the type chip. Keys are catalogue strings, translated at render. */
const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: "Lecture",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  TASK: "Study",
  DND: "Busy",
};

/** A short countdown to `start`, rounded to 5 minutes. */
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
 * The day at a glance, laid out like a weather widget: the current item large
 * up top with its countdown, and the rest of the day as an hourly strip below.
 */
export function TodayCard() {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!sessions) return null;

  const view: TodayView = buildToday(sessions, now, tz);
  const next = view.next;

  if (!next) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-3xl bg-gradient-to-br from-amber-200/70 via-orange-200/60 to-rose-200/60 p-5 text-stone-800 dark:from-amber-900/40 dark:via-orange-900/30 dark:to-rose-900/30 dark:text-stone-100">
        <div className="min-w-0">
          <p className="text-sm opacity-80">{t("Today")}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{t("Nothing left today")}</p>
        </div>
        <EmptyMark size={64} />
      </section>
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
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Could not start this session")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-3xl p-5 shadow-sm",
        "bg-gradient-to-br from-sky-200/70 via-indigo-100/60 to-violet-200/60 text-stone-800",
        "dark:from-sky-900/50 dark:via-indigo-900/40 dark:to-violet-900/40 dark:text-stone-100",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            tone.badge,
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {t(started ? "On now" : "Up next")}
        </span>
        <span className="text-sm font-medium tabular-nums opacity-80">
          {untilLabel(next.start, now)}
        </span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-3xl font-semibold tracking-tight">{next.title}</p>
        <p className="text-sm opacity-70">{t(TYPE_LABEL[next.type])}</p>
        <p className="mt-1 text-sm tabular-nums opacity-80">
          {t("{start} to {end}", {
            start: format(zonedDate(next.start, tz), "HH:mm"),
            end: format(zonedDate(next.end, tz), "HH:mm"),
          })}
        </p>
      </div>

      <div className="flex items-end justify-between gap-3">
        <Hourly items={view.later} tz={tz} />
        <Button size="sm" className="shrink-0 rounded-full" disabled={busy} onClick={start}>
          <Play className="size-4" aria-hidden />
          {t("Start")}
        </Button>
      </div>
    </section>
  );
}
