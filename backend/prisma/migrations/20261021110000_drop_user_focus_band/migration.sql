-- ADR-0036: the onboarding focus band is gone. Destructive and irreversible: back up first.
-- AlterTable
ALTER TABLE "User" DROP COLUMN "focusBand";

-- DropEnum
DROP TYPE "FocusBand";
