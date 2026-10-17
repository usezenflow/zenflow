-- Morning brief and evening check-in push times are removed (level-up plan).
ALTER TABLE "User" DROP COLUMN "morningBriefTime", DROP COLUMN "eveningCheckinTime";
