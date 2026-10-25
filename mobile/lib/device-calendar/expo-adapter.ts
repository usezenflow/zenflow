import { Platform } from "react-native";
import * as Calendar from "expo-calendar";
import type { DeviceEventSpec } from "./plan";
import type { CalendarAdapter } from "./sync";

const CALENDAR_TITLE = "Zenflow";
const CALENDAR_COLOR = "#FF6900";

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

  async ensureCalendar(existingId) {
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    const found =
      calendars.find((c) => c.id === existingId) ??
      calendars.find((c) => c.title === CALENDAR_TITLE && c.allowsModifications);
    if (found) return found.id;

    const source =
      Platform.OS === "ios"
        ? Calendar.getDefaultCalendarSync().source
        : { isLocalAccount: true, name: CALENDAR_TITLE, type: Calendar.SourceType.LOCAL };
    const created = await Calendar.createCalendar({
      title: CALENDAR_TITLE,
      color: CALENDAR_COLOR,
      entityType: Calendar.EntityTypes.EVENT,
      source,
      name: CALENDAR_TITLE,
      ownerAccount: CALENDAR_TITLE,
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
      return {
        startMs: new Date(event.startDate).getTime(),
        endMs: new Date(event.endDate).getTime(),
      };
    } catch {
      // Gone, or unreadable: the sync rewrites it from Zenflow either way.
      return null;
    }
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
