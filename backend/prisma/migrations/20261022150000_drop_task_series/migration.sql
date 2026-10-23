-- Task series (one TASK split into several sittings) are removed. Recurring
-- series (rrule, SessionSeries.rrule) are unaffected.

-- DropIndex
DROP INDEX IF EXISTS "SessionEvent_seriesId_idx";

-- AlterTable
ALTER TABLE "SessionEvent" DROP COLUMN "seriesId";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "sessionIndex",
DROP COLUMN "sessionTotal";

-- AlterTable
ALTER TABLE "SessionSeries" DROP COLUMN "deadline";
