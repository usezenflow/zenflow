/**
 * Passive exposure the app reports (`POST /client-events`). Nothing here asks the
 * student for anything: an offer shown, and an app open.
 */

/** What happened. `OFFER_SHOWN` carries a `channel`; `APP_OPEN` does not. */
export type ClientEventKindName = "OFFER_SHOWN" | "APP_OPEN";

/** Where a plan offer was shown. */
export type OfferChannel = "PUSH" | "INBOX" | "TOAST";

export interface ClientEventInput {
  kind: ClientEventKindName;
  /** `null` for `APP_OPEN`. */
  channel: OfferChannel | null;
  /** The offer's proposal, or `null`. */
  slotProposalId: string | null;
  /** The prep plan the offer is for, or `null`. */
  sessionId: string | null;
}

/** Body of `POST /client-events`. At most 50 events per request. */
export interface RecordClientEventsRequest {
  events: ClientEventInput[];
}

/** `data` of `POST /client-events`. */
export interface RecordClientEventsResponse {
  recorded: number;
}
