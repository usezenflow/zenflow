-- AlterEnum
ALTER TYPE "DevicePlatform" ADD VALUE 'WEB';

-- AlterTable
ALTER TABLE "UserDevice" ADD COLUMN     "auth" TEXT,
ADD COLUMN     "p256dh" TEXT;
