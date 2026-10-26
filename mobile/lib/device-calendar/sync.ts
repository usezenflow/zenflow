import type { Session } from "@zenflow/shared";
import {
  buildSpecs,
  CALENDAR_KINDS,
  type CalendarKind,
  planSync,
  type DeviceEventSpec,
  type DeviceLinks,
  type PlanContext,
} from "./plan";
import type { PhoneTimes } from "./moves";
import type { BusyEvent } from "./busy";

/** The phone's calendar, as the sync needs it. The Expo implementation is in `expo-adapter.ts`. */
export interface CalendarAdapter {
  /** Asks for access; true when granted. */
  requestPermission(): Promise<boolean>;
  /** The id of the Zenflow calendar for `kind`, creating it when `existingId` is missing or gone. */
  ensureCalendar(kind: CalendarKind, existingId: string | null): Promise<string>;
  createEvent(calendarId: string, spec: DeviceEventSpec): Promise<string>;
  /**
   * Start, end and first alarm of an event as the phone holds it. Null when it
   * is gone; undefined when it could not be read this time.
   */
  readEvent(eventId: string): Promise<PhoneTimes | null | undefined>;
  /** The phone's timed, busy events in the window, outside the Zenflow calendars. */
  listBusy(from: Date, to: Date, ignoreCalendarIds: string[]): Promise<BusyEvent[]>;
  /** Rejects when the event no longer exists. */
  updateEvent(eventId: string, spec: DeviceEventSpec): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
  deleteCalendar(calendarId: string): Promise<void>;
}

export interface DeviceCalendarState {
  enabled: boolean;
  calendarIds: Record<CalendarKind, string | null>;
  links: DeviceLinks;
  /** Epoch ms of the last completed sync. */
  syncedAt: number | null;
}

export const EMPTY_STATE: DeviceCalendarState = {
  enabled: false,
  calendarIds: { TASK: null, EXAM: null, ASSIGNMENT: null, LECTURE: null },
  links: {},
  syncedAt: null,
};

export interface SyncResult {
  state: DeviceCalendarState;
  created: number;
  updated: number;
  removed: number;
  failed: number;
}

/**
 * Makes the Zenflow calendar on the phone match `sessions`. Zenflow is the
 * source of truth; edits made to its events on the phone are overwritten on
 * the next change. One event failing does not stop the rest.
 */
export async function syncDeviceCalendar(
  adapter: CalendarAdapter,
  state: DeviceCalendarState,
  sessions: Session[],
  ctx: PlanContext,
  now = Date.now(),
): Promise<SyncResult> {
  const calendarIds: Record<CalendarKind, string> = { TASK: "", EXAM: "", ASSIGNMENT: "", LECTURE: "" };
  const links: DeviceLinks = { ...state.links };
  for (const kind of CALENDAR_KINDS) {
    const before = state.calendarIds[kind];
    calendarIds[kind] = await adapter.ensureCalendar(kind, before);
    // A new calendar id means the old one was deleted on the phone, and its events with it.
    if (before && before !== calendarIds[kind]) {
      for (const [key, l] of Object.entries(links)) if ((l.kind ?? "TASK") === kind) delete links[key];
    }
  }
  const specs = buildSpecs(sessions, ctx);
  // Exams and assignments used to share the task calendar: move them to their own.
  for (const spec of specs) {
    const old = links[spec.key];
    if (!old || (old.kind ?? "TASK") === spec.kind) continue;
    await adapter.deleteEvent(old.eventId).catch(() => undefined);
    delete links[spec.key];
  }
  const plan = planSync(specs, links, ctx);
  const result = { created: 0, updated: 0, removed: 0, failed: 0 };

  const link = (spec: DeviceEventSpec, eventId: string) => {
    links[spec.key] = {
      eventId,
      kind: spec.kind,
      hash: spec.hash,
      startMs: spec.startDate.getTime(),
      endMs: spec.endDate.getTime(),
      alarmMinutes: spec.alarmMinutes,
    };
  };
  const create = async (spec: DeviceEventSpec) => {
    link(spec, await adapter.createEvent(calendarIds[spec.kind], spec));
    result.created++;
  };

  for (const spec of plan.create) {
    try {
      await create(spec);
    } catch {
      result.failed++;
    }
  }
  for (const { spec, eventId } of plan.update) {
    try {
      await adapter.updateEvent(eventId, spec);
      link(spec, eventId);
      result.updated++;
    } catch {
      // The event was deleted on the phone: write it again.
      try {
        await create(spec);
      } catch {
        result.failed++;
      }
    }
  }
  for (const { key, eventId } of plan.remove) {
    try {
      await adapter.deleteEvent(eventId);
    } catch {
      // Already gone: the link goes either way.
    }
    delete links[key];
    result.removed++;
  }

  return { ...result, state: { ...state, calendarIds, links, syncedAt: now } };
}

/** Turns the sync off and takes the Zenflow calendar, with its events, off the phone. */
export async function removeDeviceCalendar(
  adapter: CalendarAdapter,
  state: DeviceCalendarState,
): Promise<DeviceCalendarState> {
  for (const id of Object.values(state.calendarIds)) {
    if (!id) continue;
    try {
      await adapter.deleteCalendar(id);
    } catch {
      // Gone already.
    }
  }
  return { ...EMPTY_STATE };
}
