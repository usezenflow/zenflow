-- AlterTable
ALTER TABLE "User" ADD COLUMN "calendarFeedCreatedAt" TIMESTAMP(3),
ADD COLUMN "calendarFeedTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarFeedTokenHash_key" ON "User"("calendarFeedTokenHash");
