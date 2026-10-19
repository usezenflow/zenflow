-- AlterTable
ALTER TABLE "Session" ADD COLUMN "prepForOccurrenceStart" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Session_prepForSessionId_idx" ON "Session"("prepForSessionId");

-- One live prep per target occurrence. NULL occurrence (exam, assignment) is one prep per target.
CREATE UNIQUE INDEX "Session_prep_target_key"
  ON "Session"("userId", "prepForSessionId", COALESCE("prepForOccurrenceStart", 'epoch'::timestamp))
  WHERE "prepForSessionId" IS NOT NULL AND "deleted" = false;

-- AlterTable
ALTER TABLE "SparkLedger" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SparkLedger_userId_sessionId_key" ON "SparkLedger"("userId", "sessionId");

-- AlterTable
ALTER TABLE "SessionSeries" ADD COLUMN "skippedFrom" TIMESTAMP(3);
