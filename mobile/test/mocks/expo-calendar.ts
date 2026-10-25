/** Vitest stand-in for expo-calendar: the real module needs the native runtime. */
export const EntityTypes = { EVENT: "event", REMINDER: "reminder" };
export const Availability = { BUSY: "busy", FREE: "free" };
export const CalendarAccessLevel = { OWNER: "owner" };
export const SourceType = { LOCAL: "local" };

export const requestCalendarPermissions = async () => ({ granted: true });
export const getCalendars = async () => [];
export const getDefaultCalendarSync = () => ({ source: { id: "local", name: "Local", type: "local" } });
export const createCalendar = async () => ({ id: "cal-1" });

export const ExpoCalendar = {
  get: async () => ({ createEvent: async () => ({ id: "ev-1" }), delete: async () => {} }),
};
export const ExpoCalendarEvent = {
  get: async () => ({ update: async () => {}, delete: async () => {} }),
};
