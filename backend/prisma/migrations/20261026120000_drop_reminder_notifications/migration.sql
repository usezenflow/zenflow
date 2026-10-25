-- Reminders are removed. Their inbox rows would not map to a category any more.
DELETE FROM "Notification" WHERE "eventName" LIKE 'reminder.%';
