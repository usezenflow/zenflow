export type CalendarConnectionState = "ACTIVE" | "NEEDS_RECONNECT";

/** `data` payload for `GET /google-calendar`. */
export interface GoogleCalendarStatus {
  /** False when the server has no Google credentials configured. */
  available: boolean;
  connected: boolean;
  state: CalendarConnectionState | null;
  /** ISO-8601 instant of the last completed sync, or null. */
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** `data` payload for `POST /google-calendar/connect`. */
export interface GoogleCalendarConnectResponse {
  url: string;
}
