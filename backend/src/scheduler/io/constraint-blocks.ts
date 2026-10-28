import { SESSION_WINDOW_HOURS, type IntervalMs } from "@zenflow/shared";
import { minutesToUtc } from "../../common/utils";
import type { PlacementConstraint } from "../types/placement.types";

/**
 * The part of one local day a task may not start in, as extra occupied time.
 * Feeding the placer blocked intervals keeps its contract unchanged; the TS
 * fallback applies the same blocks. `overhangMs` also blocks the next morning for an
 * evening window, so a late start cannot run past midnight into it.
 * shortcut: a task displaced while placing another ignores its own bounds; add
 * them to the flexible wire if that shows up.
 */
export function constraintBlocks(
  day: { dayStr: string; dayStartMs: number; dayEndMs: number },
  timezone: string,
  { notBefore, window, extraOccupied }: PlacementConstraint,
  overhangMs: number,
): IntervalMs[] {
  const out: IntervalMs[] = (extraOccupied ?? []).filter(
    (iv) => iv.endMs > day.dayStartMs && iv.startMs < day.dayEndMs + overhangMs,
  );
  if (notBefore && notBefore.getTime() > day.dayStartMs) {
    out.push({
      startMs: day.dayStartMs,
      endMs: Math.min(notBefore.getTime(), day.dayEndMs),
    });
  }
  if (window) {
    const [from, to] = SESSION_WINDOW_HOURS[window];
    const at = (h: number) =>
      minutesToUtc(day.dayStr, h * 60, timezone).getTime();
    if (from > 0) out.push({ startMs: day.dayStartMs, endMs: at(from) });
    if (to < 24) out.push({ startMs: at(to), endMs: day.dayEndMs });
    else if (overhangMs > 0)
      out.push({ startMs: day.dayEndMs, endMs: day.dayEndMs + overhangMs });
  }
  return out;
}
