-- Thin layer (ADR-0039, ADR-0042): learning rests on KEPT and MOVED only, and
-- skip, done, location data, user settings and uploaded files are removed.
--
-- DESTRUCTIVE AND IRREVERSIBLE: DONE and START events, skipped state,
-- occurrence states, map and commute data, home and reminder settings and the
-- File table are dropped. Back up the database before applying.

DELETE FROM "SessionEvent" WHERE "eventType"::text IN ('DONE', 'START');

UPDATE "SlotProposal"
SET "firstModificationType" = NULL
WHERE "firstModificationType"::text IN ('DONE', 'START');

-- AlterEnum
BEGIN;
CREATE TYPE "SessionEventType_new" AS ENUM ('CREATE', 'MOVE', 'SYSTEM_MOVE', 'KEPT');
ALTER TABLE "SlotProposal" ALTER COLUMN "firstModificationType" TYPE "SessionEventType_new" USING ("firstModificationType"::text::"SessionEventType_new");
ALTER TABLE "SessionEvent" ALTER COLUMN "eventType" TYPE "SessionEventType_new" USING ("eventType"::text::"SessionEventType_new");
ALTER TYPE "SessionEventType" RENAME TO "SessionEventType_old";
ALTER TYPE "SessionEventType_new" RENAME TO "SessionEventType";
DROP TYPE "SessionEventType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "SessionOccurrenceState" DROP CONSTRAINT "SessionOccurrenceState_seriesId_fkey";

-- DropForeignKey
ALTER TABLE "SessionOccurrenceState" DROP CONSTRAINT "SessionOccurrenceState_userId_fkey";

-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "defaultReminderMinutes",
DROP COLUMN "defaultTransport",
DROP COLUMN "homeLat",
DROP COLUMN "homeLng",
DROP COLUMN "homeLocation";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "commuteAuto",
DROP COLUMN "commuteMinutes",
DROP COLUMN "locationLat",
DROP COLUMN "locationLng",
DROP COLUMN "originLat",
DROP COLUMN "originLng",
DROP COLUMN "originLocation",
DROP COLUMN "skipped";

-- AlterTable
ALTER TABLE "SessionSeries" DROP COLUMN "skippedFrom";

-- DropTable
DROP TABLE "SessionOccurrenceState";

-- DropTable
DROP TABLE "File";

-- DropEnum
DROP TYPE "CommuteTransport";

