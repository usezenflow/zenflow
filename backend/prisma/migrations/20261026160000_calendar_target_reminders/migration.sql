-- One calendar target per user (Google or the phone), default reminders, the
-- change-log source and busy time imported from other calendars.

-- CreateEnum
CREATE TYPE "CalendarTarget" AS ENUM ('NONE', 'GOOGLE', 'DEVICE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "calendarTarget" "CalendarTarget" NOT NULL DEFAULT 'NONE',
ADD COLUMN "defaultReminderMinutes" INTEGER NOT NULL DEFAULT 30;

-- Users with a Google connection already use Google as their target.
UPDATE "User" SET "calendarTarget" = 'GOOGLE'
WHERE "id" IN (SELECT "userId" FROM "CalendarConnection");

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "reminderMinutes" INTEGER;

-- AlterEnum
ALTER TYPE "SessionSource" ADD VALUE 'GOOGLE';
ALTER TYPE "SessionSource" ADD VALUE 'DEVICE';

-- AlterEnum
ALTER TYPE "SessionEventType" ADD VALUE 'DELETE';
ALTER TYPE "SessionEventType" ADD VALUE 'EDIT';

-- CreateEnum
CREATE TYPE "SessionEventSource" AS ENUM ('ZENFLOW', 'GOOGLE', 'DEVICE');

-- AlterTable
ALTER TABLE "SessionEvent" ADD COLUMN "source" "SessionEventSource" NOT NULL DEFAULT 'ZENFLOW';

-- A change to the user's timezone or default reminder re-renders every event,
-- so the outbox syncs the user (same marker as a session change).
CREATE OR REPLACE FUNCTION calendar_user_outbox_mark() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "CalendarConnection" c
        WHERE c."userId" = NEW."id" AND c."status" = 'ACTIVE'
    ) THEN
        INSERT INTO "CalendarSyncOutbox" ("userId", "dirtyAt", "nextAttemptAt")
        VALUES (NEW."id", now(), now())
        ON CONFLICT ("userId") DO UPDATE SET
            "dirtyAt" = now(),
            "nextAttemptAt" = LEAST("CalendarSyncOutbox"."nextAttemptAt", now());
        PERFORM pg_notify('calendar_outbox', NEW."id");
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_calendar_outbox"
AFTER UPDATE OF "timezone", "defaultReminderMinutes" ON "User"
FOR EACH ROW
WHEN (OLD."timezone" IS DISTINCT FROM NEW."timezone"
   OR OLD."defaultReminderMinutes" IS DISTINCT FROM NEW."defaultReminderMinutes")
EXECUTE FUNCTION calendar_user_outbox_mark();
