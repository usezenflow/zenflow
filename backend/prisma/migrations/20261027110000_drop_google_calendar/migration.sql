-- Google Calendar sync is removed: the schedule is shown only in the phone calendar.

DROP TRIGGER "SessionSeries_calendar_outbox" ON "SessionSeries";
DROP TRIGGER "User_calendar_outbox" ON "User";
DROP TRIGGER "Session_calendar_outbox" ON "Session";
DROP FUNCTION calendar_user_outbox_mark();
DROP FUNCTION calendar_outbox_mark();

DROP TABLE "CalendarSyncOutbox";
DROP TABLE "CalendarLink";
DROP TABLE "CalendarConnection";
DROP TYPE "CalendarSyncStatus";

ALTER TABLE "Session" DROP COLUMN "attendees";

-- Rows that named Google fall back to a value that stays in the enum.
UPDATE "User" SET "calendarTarget" = 'NONE' WHERE "calendarTarget" = 'GOOGLE';
DELETE FROM "Session" WHERE "source" = 'GOOGLE';
UPDATE "SessionEvent" SET "source" = 'ZENFLOW' WHERE "source" = 'GOOGLE';

ALTER TYPE "CalendarTarget" RENAME TO "CalendarTarget_old";
CREATE TYPE "CalendarTarget" AS ENUM ('NONE', 'DEVICE');
ALTER TABLE "User" ALTER COLUMN "calendarTarget" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "calendarTarget" TYPE "CalendarTarget" USING ("calendarTarget"::text::"CalendarTarget");
ALTER TABLE "User" ALTER COLUMN "calendarTarget" SET DEFAULT 'NONE';
DROP TYPE "CalendarTarget_old";

ALTER TYPE "SessionSource" RENAME TO "SessionSource_old";
CREATE TYPE "SessionSource" AS ENUM ('USER', 'LMS', 'PORTAL', 'AUTO', 'DEVICE');
ALTER TABLE "Session" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "Session" ALTER COLUMN "source" TYPE "SessionSource" USING ("source"::text::"SessionSource");
ALTER TABLE "Session" ALTER COLUMN "source" SET DEFAULT 'USER';
DROP TYPE "SessionSource_old";

ALTER TYPE "SessionEventSource" RENAME TO "SessionEventSource_old";
CREATE TYPE "SessionEventSource" AS ENUM ('ZENFLOW', 'DEVICE');
ALTER TABLE "SessionEvent" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "SessionEvent" ALTER COLUMN "source" TYPE "SessionEventSource" USING ("source"::text::"SessionEventSource");
ALTER TABLE "SessionEvent" ALTER COLUMN "source" SET DEFAULT 'ZENFLOW';
DROP TYPE "SessionEventSource_old";
