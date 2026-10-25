/**
 * Bulk session create: `POST /sessions/bulk` and the token API. Items are
 * saved in order; a failing item does not stop the rest.
 */
import type { CreateSessionInput } from "./task";

/** Most sessions one bulk request creates. */
export const MAX_BULK_SESSIONS = 20;

/** `POST /sessions/bulk` body. `items` holds 1 to `MAX_BULK_SESSIONS` entries. */
export interface BulkCreateSessionsInput {
  /** Propose each start without writing anything. */
  dryRun?: boolean;
  items: CreateSessionInput[];
}

export type BulkCreateItemResult =
  | {
      index: number;
      status: "CREATED";
      id: string;
      scheduledStartTime: string | null;
    }
  | { index: number; status: "PROPOSED"; proposedStart: string | null }
  | { index: number; status: "ERROR"; code: string; message: string };

/** `POST /sessions/bulk` response data. `results` follows the item order. */
export interface BulkCreateSessionsResponse {
  dryRun: boolean;
  results: BulkCreateItemResult[];
}
