/**
 * An upstream answered a request made with a signed-in session as if the
 * session were no longer valid: a 401 or 403, an LMS redirect to `/login/`, or
 * an AJAX error for a missing login or sesskey. Thrown by the portal and LMS
 * clients so the session cache can drop the stale session and sign in once more.
 */
export class UpstreamSessionRejectedError extends Error {
  constructor(readonly upstream: "portal" | "dkhp" | "lms") {
    super(`${upstream} rejected the signed-in session`);
    this.name = "UpstreamSessionRejectedError";
  }
}
