-- Removes the completion, wrong-time, lapse and legacy RETAINED and MISSED
-- signals (ADR-0035). Learning rests on START, MOVE and the pairwise tap.
--
-- DESTRUCTIVE AND IRREVERSIBLE: the deleted SessionEvent rows are not
-- recoverable. Back up the database before applying.

DELETE FROM "SessionEvent"
WHERE "eventType"::text IN ('COMPLETE', 'SKIP', 'WRONG_TIME', 'LAPSED', 'RETAINED', 'MISSED');

UPDATE "SlotProposal"
SET "firstModificationType" = NULL
WHERE "firstModificationType"::text IN ('COMPLETE', 'SKIP', 'WRONG_TIME', 'LAPSED', 'RETAINED', 'MISSED');

-- Postgres cannot drop enum values, so the type is rebuilt. Altering the
-- partitioned parent also rewrites every partition.
ALTER TYPE "SessionEventType" RENAME TO "SessionEventType_old";
CREATE TYPE "SessionEventType" AS ENUM ('CREATE', 'MOVE', 'SYSTEM_MOVE', 'START');
ALTER TABLE "SessionEvent" ALTER COLUMN "eventType" TYPE "SessionEventType" USING "eventType"::text::"SessionEventType";
ALTER TABLE "SlotProposal" ALTER COLUMN "firstModificationType" TYPE "SessionEventType" USING "firstModificationType"::text::"SessionEventType";
DROP TYPE "SessionEventType_old";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "completedAt",
DROP COLUMN "retainedAt";

-- AlterTable
ALTER TABLE "SessionOccurrenceState" DROP COLUMN "completedAt";
