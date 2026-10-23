import { FileText, GraduationCap } from "lucide-react";
import type { BufferItem, WeeklyRecap } from "@zenflow/shared";
import { EmptyMark } from "@/components/brand/state-marks";
import { locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MINUTES_PER_HOUR = 60;

function hoursLabel(minutes: number): string {
  const hours = (minutes / MINUTES_PER_HOUR).toLocaleString(locale(), { maximumFractionDigits: 1 });
  return t("{h} h", { h: hours });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Planned and done time, on-time count and "Not this time" count for the week. */
export function WeeklyRecapCard({ recap }: { recap: WeeklyRecap }) {
  const quiet =
    recap.plannedMinutes === 0 &&
    recap.doneMinutes === 0 &&
    recap.onTimeCount === 0 &&
    recap.notThisTimeCount === 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-[15px] font-semibold">{t("This week")}</h3>
      {quiet ? (
        <div className="mt-3 flex flex-col items-center gap-2 py-2 text-center">
          <EmptyMark size={48} />
          <p className="text-[13px] text-muted-foreground">{t("Nothing planned this week yet")}</p>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Stat label={t("Planned")} value={hoursLabel(recap.plannedMinutes)} />
          <Stat label={t("Done")} value={hoursLabel(recap.doneMinutes)} />
          <Stat label={t("On time")} value={String(recap.onTimeCount)} />
          <Stat label={t("Not this time")} value={String(recap.notThisTimeCount)} />
        </dl>
      )}
    </section>
  );
}

const TYPE_ICON = { EXAM: GraduationCap, ASSIGNMENT: FileText } as const;

/** Status text for a buffer: days of planned prep before the due time. */
function bufferLabel(days: number | null): string {
  if (days === null) return t("Nothing planned yet");
  if (days === 0) return t("Prep ready, less than a day");
  if (days === 1) return t("Prep ready, 1 day");
  return t("Prep ready, {count} days", { count: days });
}

/** Upcoming exams and assignments with their prep status. */
export function BufferChips({ items }: { items: BufferItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <EmptyMark size={48} />
        <p className="text-[13px] text-muted-foreground">{t("No upcoming exams or assignments")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => {
        const Icon = TYPE_ICON[item.type];
        const ready = item.bufferDays !== null;
        return (
          <li
            key={item.sessionId}
            className={cn(
              "flex max-w-full min-w-0 items-center gap-2 rounded-full px-3 py-1.5 text-[13px]",
              ready ? "bg-primary/10 text-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate font-medium">{item.title}</span>
            <span className="shrink-0 opacity-80">{bufferLabel(item.bufferDays)}</span>
          </li>
        );
      })}
    </ul>
  );
}
