-- The ICS feed is removed. Drop its per-user secret.
DROP INDEX IF EXISTS "User_calendarFeedTokenHash_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "calendarFeedCreatedAt",
  DROP COLUMN IF EXISTS "calendarFeedTokenHash";
