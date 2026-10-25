/**
 * `GET|POST|DELETE /users/me/calendar-feed`. `path` is set only in the response
 * to a create or rotate, since only a hash of the secret is stored.
 */
export interface CalendarFeedResponse {
  enabled: boolean;
  createdAt: string | null;
  path: string | null;
}
