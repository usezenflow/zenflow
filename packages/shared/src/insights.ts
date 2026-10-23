/**
 * Read-only aggregates over the user's own `SessionEvent` rows, for the focus
 * map, the weekly recap and the buffer meter. No marks, no other users.
 */

export interface FocusCell {
  /** 0 = Monday … 6 = Sunday, in the user's timezone. */
  weekday: number;
  /** 0 to 23, in the user's timezone. */
  hour: number;
  /** Sessions finished (DONE) in this cell over the window. */
  done: number;
}

export interface WeeklyRecap {
  /** Minutes of placed TASK time that fell in the window. */
  plannedMinutes: number;
  /** Minutes of sessions marked done. */
  doneMinutes: number;
  /** Sessions marked "Not this time". */
  notThisTimeCount: number;
  /** Done sessions finished before their deadline. */
  onTimeCount: number;
}

export interface BufferItem {
  sessionId: string;
  title: string;
  type: "EXAM" | "ASSIGNMENT";
  /** ISO instant of the due time. */
  dueAt: string;
  /**
   * Whole days of planned, not-yet-done prep before `dueAt`, or `null` when
   * nothing is planned for it.
   */
  bufferDays: number | null;
}

/** `GET /users/me/insights?from=YYYY-MM-DD&to=YYYY-MM-DD`. */
export interface InsightsResponse {
  window: { from: string; to: string };
  focus: FocusCell[];
  recap: WeeklyRecap;
  buffers: BufferItem[];
}
