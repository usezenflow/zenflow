-- Calendar outbox: one dirty marker per user. Any change to a user's sessions
-- marks the user here in the same transaction, and NOTIFYs the outbox process,
-- which syncs the user to Google Calendar. Only users with an active connection
-- are marked.
CREATE TABLE "CalendarSyncOutbox" (
    "userId" TEXT NOT NULL,
    "dirtyAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "claimedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "CalendarSyncOutbox_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "CalendarSyncOutbox_nextAttemptAt_idx" ON "CalendarSyncOutbox"("nextAttemptAt");

CREATE OR REPLACE FUNCTION calendar_outbox_mark() RETURNS trigger AS $$
DECLARE
    uid TEXT := COALESCE(NEW."userId", OLD."userId");
BEGIN
    IF EXISTS (
        SELECT 1 FROM "CalendarConnection" c
        WHERE c."userId" = uid AND c."status" = 'ACTIVE'
    ) THEN
        INSERT INTO "CalendarSyncOutbox" ("userId", "dirtyAt", "nextAttemptAt")
        VALUES (uid, now(), now())
        ON CONFLICT ("userId") DO UPDATE SET
            "dirtyAt" = now(),
            "nextAttemptAt" = LEAST("CalendarSyncOutbox"."nextAttemptAt", now());
        PERFORM pg_notify('calendar_outbox', uid);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Session_calendar_outbox"
AFTER INSERT OR UPDATE OR DELETE ON "Session"
FOR EACH ROW EXECUTE FUNCTION calendar_outbox_mark();
