# ADR-0039: Thin layer, calendar native

**Status:** accepted, web app superseded by ADR-0046
**Date:** 2026-10-25
**Issue:** none

## Context
- Students already live in Google Calendar and their phone's calendar app. Our calendar, task form and reminders duplicated them.
- Store review and fees make native distribution a poor fit.
- AI assistants (Claude, ChatGPT) can create tasks in plain language over MCP.

## Decision
- Zenflow owns the scheduling engine, ingestion, custom notifications, login, onboarding and settings.
- Tasks enter through MCP and ingestion only. The schedule is projected to Google Calendar, and phone calendars read it from there.
- The PWA is reduced to login, onboarding and settings. The mobile app stays.
- Remove per-session reminders: `SessionReminder`, `reminders` on session DTOs and responses, the reminder queue job and `reminders/`. `User.defaultReminderMinutes` stays and will set the Google event reminder.
- Remove the PWA calendar, task forms, notes editor and notification inbox. The mobile app is upgraded to Expo SDK 58 stable and writes a phone calendar with `expo-calendar`.
- Google Calendar sync is [ADR-0040](0040-google-calendar-sync.md); assistant sign-in is [ADR-0041](0041-mcp-oauth.md).

## Consequences
- Old app builds that send or read `reminders` get validation errors or `undefined`.
- Migration `drop_session_reminder` drops existing reminders.
- `GET /sessions` and the other routes stay for mobile and MCP.
