-- Drops the SessionOccurrenceState completion index before its column goes (ADR-0035).
-- CONCURRENTLY cannot run in a transaction, so it is the only statement here.
DROP INDEX CONCURRENTLY IF EXISTS "SessionOccurrenceState_userId_completedAt_idx";
