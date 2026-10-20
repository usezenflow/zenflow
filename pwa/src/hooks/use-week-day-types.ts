import { useEffect, useState } from "react";
import { listSessions } from "@/api/tasks";
import { dayBarsByDay, type DayBar } from "@/lib/day-bar";
import { WEEK_STARTS_ON } from "@zenflow/core";
import { startOfWeek } from "date-fns";

/**
 * Day bars for the week containing `visibleDate`. Refetches when that week
 * changes and when a session is created, moved or deleted.
 */
export function useWeekDayBars(visibleDate: Date, tz: string, enabled: boolean): Map<string, DayBar> {
  const monday = startOfWeek(visibleDate, { weekStartsOn: WEEK_STARTS_ON });
  const weekKey = `${tz}|${monday.getTime()}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; bars: Map<string, DayBar> }>({
    key: "",
    bars: new Map(),
  });

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    window.addEventListener("zenflow:calendar-refresh", bump);
    window.addEventListener("zenflow:task-updated", bump);
    return () => {
      window.removeEventListener("zenflow:calendar-refresh", bump);
      window.removeEventListener("zenflow:task-updated", bump);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listSessions("week", monday)
      .then(({ sessions }) => {
        if (!cancelled) setState({ key: weekKey, bars: dayBarsByDay(sessions, tz) });
      })
      .catch(() => {
        // Keep the last week's bars on screen rather than blanking the strip.
      });
    return () => {
      cancelled = true;
    };
    // `monday` is derived from `weekKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey, revision, enabled]);

  return enabled && state.key === weekKey ? state.bars : new Map();
}
