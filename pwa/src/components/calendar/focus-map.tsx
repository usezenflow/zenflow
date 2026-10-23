import type { FocusCell } from "@zenflow/shared";
import { EmptyMark } from "@/components/brand/state-marks";
import { locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Below this many DONE events the grid is noise, so a line replaces it. */
const MIN_FOCUS_EVENTS = 5;

const HEAT = ["bg-muted", "bg-primary/25", "bg-primary/50", "bg-primary/75", "bg-primary"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = Array.from({ length: 7 }, (_, weekday) => weekday);

/** Weekday names from a fixed UTC Monday, so no local clock is read. */
function weekdayName(weekday: number, width: "narrow" | "long"): string {
  return new Intl.DateTimeFormat(locale(), { weekday: width, timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1 + weekday)),
  );
}

function heatLevel(done: number, max: number): number {
  if (done === 0 || max === 0) return 0;
  return Math.min(HEAT.length - 1, Math.ceil((done / max) * (HEAT.length - 1)));
}

/** DONE sessions by weekday and hour over the window. */
export function FocusMap({ cells }: { cells: FocusCell[] }) {
  const counts = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.done]));
  const total = cells.reduce((sum, cell) => sum + cell.done, 0);
  const max = cells.reduce((top, cell) => Math.max(top, cell.done), 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{t("Focus map")}</h3>
        <span className="text-[12px] text-muted-foreground">{t("Last 4 weeks")}</span>
      </div>

      {total < MIN_FOCUS_EVENTS ? (
        <div className="mt-3 flex flex-col items-center gap-2 py-2 text-center">
          <EmptyMark size={48} />
          <p className="max-w-[260px] text-[13px] text-muted-foreground">
            {t("Your focus map fills in as you finish sessions")}
          </p>
        </div>
      ) : (
        <div role="img" aria-label={t("Focus map")} className="mt-3 flex flex-col gap-[3px]">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="flex items-center gap-[3px]">
              <span className="w-4 shrink-0 text-[11px] text-muted-foreground">
                {weekdayName(weekday, "narrow")}
              </span>
              {HOURS.map((hour) => {
                const done = counts.get(`${weekday}:${hour}`) ?? 0;
                return (
                  <span
                    key={hour}
                    title={`${weekdayName(weekday, "long")} ${String(hour).padStart(2, "0")}:00, ${t("{count} done", { count: done })}`}
                    className={cn("h-3 flex-1 rounded-[3px]", HEAT[heatLevel(done, max)])}
                  />
                );
              })}
            </div>
          ))}
          <div className="flex items-center gap-[3px] pl-[19px] text-[10px] text-muted-foreground">
            {HOURS.map((hour) => (
              <span key={hour} className="flex-1 text-center">
                {hour % 6 === 0 ? hour : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
