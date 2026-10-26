-- A recurring series is one Google event: changing its rule or exclusions
-- must mark the user for the calendar outbox, like a session change does.
CREATE TRIGGER "SessionSeries_calendar_outbox"
AFTER INSERT OR UPDATE OR DELETE ON "SessionSeries"
FOR EACH ROW EXECUTE FUNCTION calendar_outbox_mark();
