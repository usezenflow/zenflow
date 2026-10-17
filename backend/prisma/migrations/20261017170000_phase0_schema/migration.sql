-- AlterEnum
ALTER TYPE "SessionSource" ADD VALUE 'AUTO';

-- CreateEnum
CREATE TYPE "CommuteTransport" AS ENUM ('WALK', 'BIKE', 'MOTORCYCLE', 'CAR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "defaultTransport" "CommuteTransport";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "prepForSessionId" TEXT;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_prepForSessionId_fkey" FOREIGN KEY ("prepForSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "SessionEventType" ADD VALUE 'START';
ALTER TYPE "SessionEventType" ADD VALUE 'WRONG_TIME';
ALTER TYPE "SessionEventType" ADD VALUE 'LAPSED';
