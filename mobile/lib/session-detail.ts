/** The session detail sheet opens tall, with no peek to drag up from. */
export const SESSION_DETAIL_SNAP_POINTS = ["92%"];

/**
 * Calendar route that opens a session's detail sheet. The calendar screen reads
 * `open` and fetches the session. A recurring occurrence id has `::` and `:`, so it is encoded.
 */
export function sessionEditHref(sessionId: string): string {
  return `/?open=${encodeURIComponent(sessionId)}`;
}
