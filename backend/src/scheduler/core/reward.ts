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
export type CompletionOutcome =
  | "DONE"
  | "STARTED"
  | "SKIPPED"
  | "WRONG_TIME"
  | "LAPSED";

/**
 * Outcome of an unmoved TASK, or `null` while it is not settled yet.
 *
 * Skip, done and started settle at `end + grace`. A start counts when it falls
 * in `[start, end)`; a check-off counts from `start` on. A check-off before
 * `start` is `WRONG_TIME`, and no start or check-off is `LAPSED`; both settle at
 * `end + cutoff`.
 */
export function completionOutcome(
  startMs: number,
  endMs: number,
  completedAtMs: number | null,
  skipped: boolean,
  nowMs: number,
  startedAtMs: number | null,
  graceMs: number = OUTCOME_GRACE_MS,
  cutoffMs: number = OUTCOME_MISS_CUTOFF_MS,
): CompletionOutcome | null {
  if (nowMs < endMs + graceMs) return null;
  if (skipped) return "SKIPPED";
  if (completedAtMs !== null && completedAtMs >= startMs) return "DONE";
  if (startedAtMs !== null && startedAtMs >= startMs && startedAtMs < endMs) {
    return "STARTED";
  }
  if (nowMs < endMs + cutoffMs) return null;
  return completedAtMs !== null ? "WRONG_TIME" : "LAPSED";
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
