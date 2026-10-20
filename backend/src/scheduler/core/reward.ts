import { MOVE_REWARD_SCALE_MINUTES } from "../constants";
import {
  OUTCOME_GRACE_MS,
  OUTCOME_MISS_CUTOFF_MS,
} from "../../common/constants";

/**
 * Pure delayed-reward math for LinUCB-placed sessions (ADR-0001 §7/§9,
 * ADR-0023). No I/O, no clock.
 */

/** Settled outcome of an unmoved placement, see {@link completionOutcome}. */
export type CompletionOutcome = "STARTED" | "LAPSED";

/**
 * Outcome of an unmoved placement, or `null` while it is not settled yet.
 *
 * A start counts when it falls in `[start, end)` and settles at `end + grace`.
 * No start settles as `LAPSED` at `end + cutoff`.
 */
export function completionOutcome(
  startMs: number,
  endMs: number,
  startedAtMs: number | null,
  nowMs: number,
  graceMs: number = OUTCOME_GRACE_MS,
  cutoffMs: number = OUTCOME_MISS_CUTOFF_MS,
): CompletionOutcome | null {
  if (nowMs < endMs + graceMs) return null;
  if (startedAtMs !== null && startedAtMs >= startMs && startedAtMs < endMs) {
    return "STARTED";
  }
  if (nowMs < endMs + cutoffMs) return null;
  return "LAPSED";
}

/**
 * Grades a drag/resize/pick displacement into a LinUCB reward in `[-1, 0]`:
 * `0` for a zero-distance move (e.g. a resize that doesn't shift the start),
 * otherwise a penalty that grows linearly with `|dragDistanceMinutes|` and
 * saturates at `-1` once the displacement reaches `MOVE_REWARD_SCALE_MINUTES`.
 */
export function dragDistanceReward(
  dragDistanceMinutes: number,
  scaleMinutes: number = MOVE_REWARD_SCALE_MINUTES,
): number {
  if (dragDistanceMinutes === 0) return 0;
  return -Math.min(1, Math.abs(dragDistanceMinutes) / scaleMinutes);
}
