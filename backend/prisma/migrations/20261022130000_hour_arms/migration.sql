-- Hour arms (L24N): one arm per local start hour replaces the six time-of-day arms.
-- Production holds no data, so arm state and arm labels on proposals are dropped.
DELETE FROM "BanditArmState";
UPDATE "SlotProposal" SET "selectedArm" = NULL WHERE "selectedArm" IS NOT NULL;

ALTER TYPE "SchedulingArm" RENAME TO "SchedulingArm_old";
CREATE TYPE "SchedulingArm" AS ENUM ('HOUR_00', 'HOUR_01', 'HOUR_02', 'HOUR_03', 'HOUR_04', 'HOUR_05', 'HOUR_06', 'HOUR_07', 'HOUR_08', 'HOUR_09', 'HOUR_10', 'HOUR_11', 'HOUR_12', 'HOUR_13', 'HOUR_14', 'HOUR_15', 'HOUR_16', 'HOUR_17', 'HOUR_18', 'HOUR_19', 'HOUR_20', 'HOUR_21', 'HOUR_22', 'HOUR_23');
ALTER TABLE "BanditArmState" ALTER COLUMN "arm" TYPE "SchedulingArm" USING "arm"::text::"SchedulingArm";
ALTER TABLE "SlotProposal" ALTER COLUMN "selectedArm" TYPE "SchedulingArm" USING "selectedArm"::text::"SchedulingArm";
DROP TYPE "SchedulingArm_old";
ALTER TABLE "BanditArmState" DROP COLUMN "version";
