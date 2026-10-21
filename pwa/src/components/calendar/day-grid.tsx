import { Event } from "@zenflow/shared";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@zenflow/core";
import { useEffect, useMemo, useRef } from "react";
import { ScheduledBlockItem } from "./scheduled-block-item";
import { HourRuler } from "./hour-ruler";
import { Cell } from "./day-cell";
import { DayColumnBackground } from "./day-column-background";
import { getOverlapLayout } from "@zenflow/core";
import { eventsForDay } from "@zenflow/core";
import { useUserStore } from "@/hooks/use-user-store";
import { useNow } from "@/hooks/use-now";
import { isZonedToday, zonedDate } from "@/utils/tz";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function minutesSinceStartOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** Where an empty day opens: the start of the default matrix's late morning hump. */
const EMPTY_DAY_ANCHOR_MIN = 9 * 60;

export function DayGrid({ events, date }: { events: Event[]; date: Date }) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const nowTop = useMemo(() => {
    const mins = minutesSinceStartOfDay(zonedDate(now, tz));
    return `${(mins / DAILY_HORIZON) * 100}%`;
  }, [now, tz]);

  // Clamp/split tasks to this day so cross-midnight tasks render their leftover
  // portion as a continuation segment at the top of the next day.
  const segments = eventsForDay(events, date, tz);
  const layout = getOverlapLayout(segments);

  // Open today on now, other days on their first session, and an empty day on
  // the late morning (where the "add a session" prompt sits). Runs once per
  // day, so later edits or the clock ticking don't move the scroll position.
  const gridRef = useRef<HTMLDivElement>(null);
  const scrolledDay = useRef<string | null>(null);
  const today = isZonedToday(date, tz);
  const firstStartMs = segments.length
    ? Math.min(...segments.map((s) => Date.parse(s.start)))
    : null;
  const anchorMin = today
    ? minutesSinceStartOfDay(zonedDate(now, tz))
    : firstStartMs == null
      ? EMPTY_DAY_ANCHOR_MIN
      : minutesSinceStartOfDay(zonedDate(new Date(firstStartMs), tz));
  useEffect(() => {
    const dayKey = `${date.toDateString()}|${tz}`;
    if (scrolledDay.current === dayKey) return;
    const grid = gridRef.current;
    const scroller = grid?.closest<HTMLElement>("[data-scroll-container]");
    if (!grid || !scroller) return;
    scroller.scrollTo({
      top: Math.max(0, (anchorMin / DAILY_HORIZON) * grid.offsetHeight - 16),
    });
    scrolledDay.current = dayKey;
  }, [date, tz, anchorMin]);

  return (
    <div ref={gridRef} className="border-border grid flex-1 grid-cols-[3rem_1fr] overflow-hidden border-t sm:grid-cols-[4rem_1fr]">
      {/* time ruler */}
      <HourRuler />

      {/* day column */}
      <div className="bg-card relative">
        <DayColumnBackground />

        {isZonedToday(date, tz) && (
          <div
            className="pointer-events-none absolute inset-x-0 z-50 animate-in fade-in transition-[top] duration-1000 ease-linear"
            style={{ top: nowTop }}
          >
            <div className="relative flex items-center">
              <div className="absolute -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm" />
              <div className="motion-safe:animate-ping absolute -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm" />
              <div className="h-[2px] w-full bg-gradient-to-r from-rose-500 via-rose-400/50 to-transparent" />
            </div>
          </div>
        )}

        {/* droppable time cells */}
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="relative h-[var(--week-cells-height)]"
          >
            {Array.from({ length: 4 }).map((_, q) => (
              <Cell
                key={`${hour}:${q * TIME_GRANULARITY}`}
                id={`${hour}:${q * TIME_GRANULARITY}`}
                quarter={q}
                hour={hour}
              />
            ))}
          </div>
        ))}

        {/* events */}
        {segments.map((segment) => (
          <ScheduledBlockItem
            layout={
              layout.get(segment.segmentId) ?? {
                column: 0,
                columns: 1,
                conflict: false,
              }
            }
            key={segment.segmentId}
            block={segment}
          />
        ))}
      </div>
    </div>
  );
}
