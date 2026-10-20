-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "slotProposalId" TEXT,
ADD COLUMN "offerSlots" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[];

-- CreateEnum
CREATE TYPE "ClientEventKind" AS ENUM ('OFFER_SHOWN', 'APP_OPEN');

-- CreateTable
CREATE TABLE "ClientEvent" (
    "id" TEXT NOT NULL,
    "kind" "ClientEventKind" NOT NULL,
    "channel" TEXT,
    "slotProposalId" TEXT,
    "sessionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ClientEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_slotProposalId_idx" ON "Notification"("slotProposalId");

-- CreateIndex
CREATE INDEX "ClientEvent_userId_occurredAt_idx" ON "ClientEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ClientEvent_slotProposalId_idx" ON "ClientEvent"("slotProposalId");

-- AddForeignKey
ALTER TABLE "ClientEvent" ADD CONSTRAINT "ClientEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
