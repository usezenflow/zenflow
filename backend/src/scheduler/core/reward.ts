import {
  DELETE_REWARD,
  DELETE_REWARD_ENABLED,
  MOVE_REWARD_SCALE_MINUTES,
} from "../constants";

/**
 * Pure reward math for LinUCB-placed sessions (ADR-0001 §7/§9, ADR-0042). No
 * I/O, no clock.
 */

/** What a delete is graded on, all taken from the delete event and the session. */
export interface DeleteSignal {
  /** Who deleted: the user (app, Google or phone), or Zenflow, ingestion or a conflict. */
  byUser: boolean;
  /** Session type. Only TASK learns from a delete. */
  type: "TASK" | "LECTURE" | "ASSIGNMENT" | "EXAM" | "DND";
  /** Session source. Only sessions the user or the scheduler made count. */
  source: "USER" | "AUTO" | "LMS" | "PORTAL" | "GOOGLE" | "DEVICE";
  /** The LinUCB arm placed it, so the arm (not the preference matrix) learns. */
  placedByLinUcb: boolean;
  everMoved: boolean;
  /** A session with the same title was created within the hour: the delete is a replace. */
  replaced: boolean;
  /** Negative once the slot began. */
  minutesToStart: number;
  minutesSincePlacement: number;
}

const DELETE_MIN_LEAD_MINUTES = 60;
const DELETE_MAX_AGE_MINUTES = 24 * 60;

/**
 * Reward for deleting a placed session, on the LinUCB arm (ADR-0043).
 * Zero everywhere the delete says nothing about the slot: a replace, a delete
 * after the slot began, a plan change close to start or long after placement,
 * and every system, ingestion or non-TASK case.
 */
export function deleteReward(signal: DeleteSignal): number {
  if (!signal.byUser || signal.type !== "TASK") return 0;
  if (signal.source !== "USER" && signal.source !== "AUTO") return 0;
  if (!signal.placedByLinUcb || signal.everMoved || signal.replaced) return 0;
  if (signal.minutesToStart < DELETE_MIN_LEAD_MINUTES) return 0;
  if (signal.minutesSincePlacement > DELETE_MAX_AGE_MINUTES) return 0;
  return DELETE_REWARD;
}

/** The reward the arm updates with: zero while shadow mode is on. */
export function armDeleteReward(signal: DeleteSignal): number {
  return DELETE_REWARD_ENABLED ? deleteReward(signal) : 0;
}

/** Grades a drag/resize/pick displacement into a LinUCB reward in `[-1, 0]`:
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
