import { useRef } from "react";
import { WEEK_STARTS_ON } from "@zenflow/core";
import { addDays, startOfWeek } from "date-fns";
import { DayBarView } from "@/components/calendar/day-bar";
import type { DayBar } from "@/lib/day-bar";
import { dayKey } from "@/lib/day-bar";
import { format, formatTitle } from "@/lib/format";
import { t, useLanguage } from "@/lib/i18n";
import { useSlideDirection } from "@/hooks/use-slide-direction";
import { cn } from "@/lib/utils";

/** Horizontal swipe distance that moves the strip one week. */
const SWIPE_DISTANCE = 48;
/** Gap between day chips in px; matches `gap-1.5`. */
const CHIP_GAP = 6;
/** Left inset of the selection pill for the chip at `index`, as a CSS length. */
const pillLeft = (index: number) =>
  `calc(${index} * ((100% - ${6 * CHIP_GAP}px) / 7 + ${CHIP_GAP}px))`;
const PILL_WIDTH = `calc((100% - ${6 * CHIP_GAP}px) / 7)`;

const NO_BAR: DayBar = { types: [], segments: [] };

interface WeekStripProps {
  /** The focused day; its week is shown and its chip is highlighted. */
  focusedDate: Date;
  /** Today in the user's zone, to mark today's number. */
  today: Date;
  bars: Map<string, DayBar>;
  onSelectDay: (day: Date) => void;
  onShiftWeek: (direction: -1 | 1) => void;
}

/**
 * The week strip above the day view: the month, the week's range, and seven
 * day chips with a load bar under each. The focused day sits under a pill that
 * slides between chips. Swipe sideways to move a week. On desktop the strip is
 * a compact centred row, since the header already shows the date.
 */
export function WeekStrip({ focusedDate, today, bars, onSelectDay, onShiftWeek }: WeekStripProps) {
  useLanguage();
  const start = startOfWeek(focusedDate, { weekStartsOn: WEEK_STARTS_ON });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const focusedKey = dayKey(focusedDate);
  const focusIndex = days.findIndex((day) => dayKey(day) === focusedKey);
  const todayKey = dayKey(today);
  const swipeX = useRef<number | null>(null);
  const week = useSlideDirection(start.getTime());

  return (
    <div
      className="flex flex-col gap-2 border-b border-border bg-background px-4 pb-2 pt-2.5 md:py-2"
      onTouchStart={(e) => {
        swipeX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = swipeX.current;
        swipeX.current = null;
        const to = e.changedTouches[0]?.clientX;
        if (from === null || to === undefined) return;
        if (to - from <= -SWIPE_DISTANCE) onShiftWeek(1);
        else if (to - from >= SWIPE_DISTANCE) onShiftWeek(-1);
      }}
    >
      <div className="min-w-0 md:hidden">
        <p className="text-xl font-bold tracking-tight">{formatTitle(focusedDate, "MMMM yyyy")}</p>
        <p className="mt-px text-sm font-medium text-muted-foreground">
          {t("{start} to {end}", {
            start: format(days[0], "MMM d"),
            end: format(days[6], "MMM d"),
          })}
        </p>
      </div>

      <div className="mx-auto w-full max-w-md overflow-hidden">
        <div
          key={week.position}
          className={cn(
            "relative grid grid-cols-7 gap-1.5",
            week.direction === "next" ? "animate-day-in-next" : "animate-day-in-prev",
          )}
        >
          {focusIndex >= 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 rounded-xl border border-[rgba(255,142,62,0.26)] bg-[rgba(255,142,62,0.12)] transition-[left] duration-200 ease-out-cubic dark:border-[rgba(255,150,80,0.3)] dark:bg-[rgba(255,122,36,0.2)]"
              style={{ left: pillLeft(focusIndex), width: PILL_WIDTH }}
            />
          )}
          {days.map((day) => {
            const key = dayKey(day);
            const isFocused = key === focusedKey;
            const isToday = key === todayKey;
            return (
              <button
                key={key}
                type="button"
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isFocused}
                onClick={() => onSelectDay(day)}
                className="relative flex flex-col items-center gap-1 rounded-xl border border-transparent py-1.5 transition-colors active:scale-95"
              >
                <span className="text-[10.5px] font-semibold text-muted-foreground">
                  {formatTitle(day, "EEE")}
                </span>
                <span
                  className={cn(
                    "flex size-[30px] items-center justify-center rounded-full text-base font-semibold",
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
                <span className="w-[22px]">
                  <DayBarView bar={bars.get(key) ?? NO_BAR} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
