-- Invitees for group study, pushed to Google. `inviteKey` tells a re-write
-- that the schedule or the invitee list changed, so Google may send invitations.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "attendees" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "CalendarLink" ADD COLUMN "inviteKey" TEXT;
