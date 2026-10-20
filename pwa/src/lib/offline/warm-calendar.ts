import { listSessions } from "@/api/tasks";
import { useConnectivity } from "@/lib/connectivity";
import { cacheKey, writeCalendar } from "@/lib/offline/cache";
import type { ViewMode } from "@zenflow/shared";
import { addDays, addMonths, startOfWeek } from "date-fns";

/** Warm at most this often, so mounts and reconnects do not refetch the same views. */
const WARM_INTERVAL_MS = 5 * 60 * 1000;
let lastWarm = 0;

/**
 * Fill the offline cache: the previous, current and next month, the previous,
 * current and next week, and each day of this week. A failed fetch is ignored
 * and the cache stays as it was.
 */
export async function warmCalendar(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!useConnectivity.getState().online) return;
  if (Date.now() - lastWarm < WARM_INTERVAL_MS) return;
  lastWarm = Date.now();

  const fetchView = (view: ViewMode, date: Date) =>
    listSessions(view, date)
      .then((res) => writeCalendar(userId, cacheKey(view, date), res.sessions))
      .catch(() => undefined);

  const jobs: Promise<unknown>[] = [];
  for (const offset of [-1, 0, 1]) jobs.push(fetchView("month", addMonths(now, offset)));
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  for (const offset of [-1, 0, 1]) jobs.push(fetchView("week", addDays(monday, offset * 7)));
  for (let i = 0; i < 7; i++) jobs.push(fetchView("day", addDays(monday, i)));
  await Promise.all(jobs);
}
