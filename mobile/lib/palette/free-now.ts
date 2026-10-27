import type { FreeSlotsResponse } from "@zenflow/shared";

/** Nothing can start in the past: trim each slot to the next quarter hour and drop what no longer fits. */
export function freeAfterNow(
  slots: FreeSlotsResponse,
  minutes: number,
  now = new Date(),
): FreeSlotsResponse {
  const q = 15 * 60_000;
  const floor = Math.ceil(now.getTime() / q) * q;
  return slots.flatMap((s) => {
    const start = Math.max(new Date(s.start).getTime(), floor);
    const free = Math.floor((new Date(s.end).getTime() - start) / 60_000);
    return free >= minutes
      ? [{ ...s, start: new Date(start).toISOString(), freeMinutes: free }]
      : [];
  });
}
