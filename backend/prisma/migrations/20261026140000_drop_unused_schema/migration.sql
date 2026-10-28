-- Drops schema the thin layer no longer reads or writes: user tags, course
-- colours, client events, the offer feedback and apply columns, the ingestion
-- sync markers and the LMS occurrence fingerprints.
--
-- DESTRUCTIVE: tag labels, course colours and client events are deleted.

-- DropTable
DROP TABLE "_SessionToTag";

-- DropTable
DROP TABLE "Tag";

-- DropTable
DROP TABLE "CourseColour";

-- DropTable
DROP TABLE "ClientEvent";

-- DropEnum
DROP TYPE "ClientEventKind";

-- AlterTable
ALTER TABLE "SlotProposal" DROP COLUMN "appliedStartTime",
DROP COLUMN "feedback",
DROP COLUMN "feedbackAt";

-- DropEnum
DROP TYPE "SlotProposalFeedback";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "syncConfirmedAt",
DROP COLUMN "syncMissedAt";

-- AlterTable
ALTER TABLE "LmsCourse" DROP COLUMN "occurrencesRefreshedAt",
DROP COLUMN "occurrencesThroughDate",
DROP COLUMN "occurrencesFingerprint",
DROP COLUMN "occurrencesFingerprintBy",
DROP COLUMN "occurrencesPriorFingerprint";

-- AlterTable
ALTER TABLE "LmsCourseEnrollment" DROP COLUMN "seenFingerprint";
