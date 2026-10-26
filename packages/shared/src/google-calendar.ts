import type { CalendarTarget } from "./user";

export type CalendarConnectionState = "ACTIVE" | "NEEDS_RECONNECT";

/** `data` payload for `GET /google-calendar`. */
export interface GoogleCalendarStatus {
  /** False when the server has no Google credentials configured. */
  available: boolean;
  /** Where the user's schedule is shown. `GOOGLE` exactly when a connection exists. */
  target: CalendarTarget;
  connected: boolean;
  state: CalendarConnectionState | null;
  /** ISO-8601 instant of the last completed sync, or null. */
  lastSyncedAt: string | null;
  /** Last error from a failed push, or null. */
  lastError: string | null;
  /** When the oldest unsynced session change was made, or null when the calendar is up to date. */
  pendingSince: string | null;
  /** When a failed push is tried again, or null. */
  retryAt: string | null;
  /** Failed pushes in a row; 0 when none. */
  attempts: number;
}

/** `data` payload for `POST /google-calendar/connect`. */
export interface GoogleCalendarConnectResponse {
  url: string;
}

/** Body of `PATCH /users/update/calendar-target`: turns the phone calendar on or off. */
export interface SetCalendarTargetInput {
  target: "NONE" | "DEVICE";
}
