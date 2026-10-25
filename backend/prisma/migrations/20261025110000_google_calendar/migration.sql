-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT');

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "status" "CalendarSyncStatus" NOT NULL DEFAULT 'ACTIVE',
    "syncToken" TEXT,
    "channelId" TEXT,
    "channelResourceId" TEXT,
    "channelExpiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "seriesId" TEXT,
    "eventId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "etag" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CalendarLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_channelId_key" ON "CalendarConnection"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_key" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "CalendarLink_userId_sessionId_idx" ON "CalendarLink"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "CalendarLink_userId_seriesId_idx" ON "CalendarLink"("userId", "seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarLink_userId_eventId_key" ON "CalendarLink"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarLink" ADD CONSTRAINT "CalendarLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

