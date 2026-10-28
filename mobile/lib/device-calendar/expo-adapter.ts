import { Platform } from "react-native";
import * as Calendar from "expo-calendar";
import { t } from "@/lib/i18n";
import type { CalendarKind, DeviceEventSpec } from "./plan";
import type { BusyEvent } from "./busy";
import type { CalendarAdapter } from "./sync";

/** The phone says "not found" for an event that was deleted; anything else is a read that failed. */
const GONE = /not found|does not exist|no such/i;

/** The phone colours a calendar, so each type gets its own. Colours follow the app's session tokens. */
const CALENDARS: Record<CalendarKind, { title: string; color: string }> = {
  TASK: { title: "Zenflow", color: "#FF6900" },
  EXAM: { title: "Exams", color: "#14A09B" },
  ASSIGNMENT: { title: "Assignments", color: "#F0B101" },
  LECTURE: { title: "Lectures", color: "#3B82C4" },
};
/** The calendar's name on the phone, in the app language. */
const calendarTitle = (kind: CalendarKind) => t(CALENDARS[kind].title);

function details(spec: DeviceEventSpec) {
  return {
    title: spec.title,
    startDate: spec.startDate,
    endDate: spec.endDate,
    timeZone: spec.timeZone,
    location: spec.location ?? undefined,
    notes: spec.notes,
    availability: Calendar.Availability.BUSY,
    alarms: spec.alarmMinutes > 0 ? [{ relativeOffset: -spec.alarmMinutes }] : [],
  };
}

/** The phone's calendar through `expo-calendar`: a local "Zenflow" calendar that only Zenflow writes to. */
export const expoCalendarAdapter: CalendarAdapter = {
  async requestPermission() {
    const res = await Calendar.requestCalendarPermissions();
    return res.granted;
  },

  async ensureCalendar(kind, existingId) {
    const { color } = CALENDARS[kind];
    const title = calendarTitle(kind);
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    // Only the task calendar is adopted by name: "Exams" may be the person's own calendar, which turning sync off would delete.
    const found =
      calendars.find((c) => c.id === existingId) ??
      (kind === "TASK" ? calendars.find((c) => c.title === CALENDARS.TASK.title && c.allowsModifications) : undefined);
    if (found) return found.id;

    const source =
      Platform.OS === "ios"
        ? Calendar.getDefaultCalendarSync().source
        : { isLocalAccount: true, name: title, type: Calendar.SourceType.LOCAL };
    const created = await Calendar.createCalendar({
      title,
      color,
      entityType: Calendar.EntityTypes.EVENT,
      source,
      name: title,
      ownerAccount: title,
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return created.id;
  },

  async createEvent(calendarId, spec) {
    const calendar = await Calendar.ExpoCalendar.get(calendarId);
    return (await calendar.createEvent(details(spec))).id;
  },

  async readEvent(eventId) {
    try {
      const event = await Calendar.ExpoCalendarEvent.get(eventId);
      const alarm = event.alarms?.find((a) => typeof a.relativeOffset === "number");
      return {
        startMs: new Date(event.startDate).getTime(),
        endMs: new Date(event.endDate).getTime(),
        alarmMinutes: alarm ? Math.max(0, Math.round(-alarm.relativeOffset!)) : 0,
      };
    } catch (error) {
      // Only a deleted event is rewritten; a read that failed is left alone this time.
      // shortcut: relies on the platform's "not found" wording, check it on both OSes.
      return GONE.test(String((error as Error)?.message ?? "")) ? null : undefined;
    }
  },

  async listBusy(from, to, ignoreCalendarIds) {
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    const ids = calendars.map((c) => c.id).filter((id) => !ignoreCalendarIds.includes(id));
    if (ids.length === 0) return [];
    const events = await Calendar.getEventsAsync(ids, from, to);
    return events
      .filter((e) => !e.allDay && e.availability !== Calendar.Availability.FREE)
      .map(
        (e): BusyEvent => ({
          externalKey: `${e.calendarId}:${e.id}`,
          title: e.title,
          start: new Date(e.startDate),
          end: new Date(e.endDate),
        }),
      );
  },

  async updateEvent(eventId, spec) {
    const event = await Calendar.ExpoCalendarEvent.get(eventId);
    await event.update(details(spec));
  },

  async deleteEvent(eventId) {
    const event = await Calendar.ExpoCalendarEvent.get(eventId);
    await event.delete();
  },

  async deleteCalendar(calendarId) {
    const calendar = await Calendar.ExpoCalendar.get(calendarId);
    await calendar.delete();
  },
};
