/**
 * Bulk session create and delete for assistants: `POST /sessions/bulk`,
 * `POST /sessions/bulk-delete` and the MCP tools. Items run in order; a failing
 * item does not stop the rest.
 */
import type { CreateSessionInput, UpdateSessionInput } from "./task";

/** Most items one bulk request creates or deletes. */
export const MAX_BULK_SESSIONS = 50;

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
      /** Two scheduler policies disagreed by at least an hour; `POST /sessions/:id/slot-pick` records the user's choice. */
      pairwise?: { slotProposalId: string; primary: string; alternative: string };
    }
  | {
      index: number;
      status: "PROPOSED";
      proposedStart: string | null;
      proposedEnd: string | null;
      timezone: string;
      /** Local weekday and time of `proposedStart`, so a client need not convert. */
      localStart?: string;
      /** Plain-language flags: odd hour, weekend, close to the deadline, overlaps another session. */
      warnings?: string[];
    }
  | { index: number; status: "ERROR"; code: string; message: string };

/** `POST /sessions/bulk` response data. `results` follows the item order. */
export interface BulkCreateSessionsResponse {
  dryRun: boolean;
  results: BulkCreateItemResult[];
}

/**
 * What one delete item removes: a `session` (an occurrence id removes that
 * occurrence), a whole recurring `series`, or a `timetable` group, which is
 * every meeting of the course (`all`) or this meeting and later ones (`following`).
 */
export type BulkDeleteKind = "session" | "series" | "timetable";

export interface BulkDeleteItem {
  kind: BulkDeleteKind;
  id: string;
  /** Timetable only. Default `all`. */
  scope?: "all" | "following";
}

/** `POST /sessions/bulk-delete` body. `items` holds 1 to `MAX_BULK_SESSIONS` entries. */
export interface BulkDeleteSessionsInput {
  /** Describe what would go without deleting anything. */
  dryRun?: boolean;
  items: BulkDeleteItem[];
}

export type BulkDeleteItemResult =
  | {
      index: number;
      status: "DELETED";
      kind: BulkDeleteKind;
      id: string;
      removed: number;
    }
  | {
      index: number;
      status: "PREVIEW";
      kind: BulkDeleteKind;
      id: string;
      title: string;
      count: number;
    }
  | {
      index: number;
      status: "ERROR";
      kind: BulkDeleteKind;
      id: string;
      code: string;
      message: string;
    };

/** `POST /sessions/bulk-delete` response data. `results` follows the item order. */
export interface BulkDeleteSessionsResponse {
  dryRun: boolean;
  results: BulkDeleteItemResult[];
}

/** `POST /sessions/bulk-update` body. Each item is one `PATCH /sessions/:id`. */
export interface BulkUpdateSessionsInput {
  items: { id: string; patch: UpdateSessionInput }[];
}

export type BulkUpdateItemResult =
  | { index: number; status: "UPDATED"; id: string }
  | { index: number; status: "ERROR"; id: string; code: string; message: string };

/** `POST /sessions/bulk-update` response data. `results` follows the item order. */
export interface BulkUpdateSessionsResponse {
  results: BulkUpdateItemResult[];
}
