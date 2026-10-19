-- AlterTable
ALTER TABLE "Session" DROP COLUMN "anchor",
DROP COLUMN "anchoredAt";

-- DropEnum
DROP TYPE "SessionAnchor";
