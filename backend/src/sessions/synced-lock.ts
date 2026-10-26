import { ForbiddenException } from "@nestjs/common";
import type { SessionSource, SessionType } from "../../generated/prisma";
import type { UpdateSessionDto } from "./dto/update-session.dto";

/** The types the portal and LMS write. */
const SYNCED_TYPES: SessionType[] = ["LECTURE", "EXAM", "ASSIGNMENT"];

/**
 * A timetable, exam or assignment written by a sync. The upstream is the
 * source of truth, so the student deletes these rather than editing them. A
 * deleted one stays deleted: the sync leaves its row alone. Sessions the
 * student created themselves stay editable.
 */
export function isSynced(row: {
  source: SessionSource;
  type: SessionType;
}): boolean {
  return (
    (row.source === "LMS" || row.source === "PORTAL") &&
    SYNCED_TYPES.includes(row.type)
  );
}

/** Fields a sync owns. Note stays the student's. */
const SYNCED_FIELDS = [
  "title",
  "location",
  "durationMinutes",
  "deadline",
  "scheduledStartTime",
  "rrule",
] as const satisfies readonly (keyof UpdateSessionDto)[];

export function assertSyncedEditable(
  row: { source: SessionSource; type: SessionType },
  dto: UpdateSessionDto,
): void {
  if (!isSynced(row)) return;
  if (SYNCED_FIELDS.some((f) => dto[f] !== undefined))
    throw new ForbiddenException(
      "Synced sessions can't be edited. Delete it instead.",
    );
}
