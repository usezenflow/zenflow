-- CreateEnum
CREATE TYPE "EggStatus" AS ENUM ('INCUBATING', 'READY', 'HATCHED');

-- CreateEnum
CREATE TYPE "SpiritRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateTable
CREATE TABLE "Egg" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "EggStatus" NOT NULL DEFAULT 'INCUBATING',
    "sparks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hatchedAt" TIMESTAMP(3),

    CONSTRAINT "Egg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spirit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eggId" TEXT NOT NULL,
    "spiritId" VARCHAR(20) NOT NULL,
    "rarity" "SpiritRarity" NOT NULL,
    "hatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Spirit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparkLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eggId" TEXT NOT NULL,
    "sessionEventId" BIGINT NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SparkLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Egg_userId_status_idx" ON "Egg"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Spirit_eggId_key" ON "Spirit"("eggId");

-- CreateIndex
CREATE INDEX "Spirit_userId_hatchedAt_idx" ON "Spirit"("userId", "hatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SparkLedger_sessionEventId_key" ON "SparkLedger"("sessionEventId");

-- CreateIndex
CREATE INDEX "SparkLedger_userId_day_idx" ON "SparkLedger"("userId", "day");

-- CreateIndex
CREATE INDEX "SparkLedger_eggId_idx" ON "SparkLedger"("eggId");

-- AddForeignKey
ALTER TABLE "Egg" ADD CONSTRAINT "Egg_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spirit" ADD CONSTRAINT "Spirit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spirit" ADD CONSTRAINT "Spirit_eggId_fkey" FOREIGN KEY ("eggId") REFERENCES "Egg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparkLedger" ADD CONSTRAINT "SparkLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparkLedger" ADD CONSTRAINT "SparkLedger_eggId_fkey" FOREIGN KEY ("eggId") REFERENCES "Egg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

