import {
  MOVE_REWARD_SCALE_MINUTES,
  SESSION_DONE_REWARD,
  SESSION_SKIP_REWARD,
} from "../constants";

/**
 * Pure reward math for LinUCB-placed sessions (ADR-0001 §7/§9, ADR-0035). No
 * I/O, no clock.
 */

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

/**
 * The LinUCB reward for the student's answer to a placed block:
 * `+1.0` for DONE, `-1.0` for SKIP, `null` for SILENT (no update, preserving
 * partial-feedback dynamics).
 */
export function answerReward(outcome: "DONE" | "SKIP" | "SILENT"): number | null {
  if (outcome === "DONE") return SESSION_DONE_REWARD;
  if (outcome === "SKIP") return SESSION_SKIP_REWARD;
  return null;
}

export { SESSION_DONE_REWARD, SESSION_SKIP_REWARD };
