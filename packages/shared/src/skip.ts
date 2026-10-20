import type { Session } from "./task";

/**
 * `data` of `POST|DELETE /sessions/:id/skip`. `session` carries the request id,
 * so an occurrence keeps its `<seriesId>::<startISO>` id.
 */
export interface SessionSkipResponse {
  session: Session;
}
