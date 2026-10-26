import type { KV } from "../session-disk";
import { EMPTY_STATE, type DeviceCalendarState } from "./sync";

const VERSION = 1;
const key = (userId: string) => `device-calendar:${userId}`;

/** Saved sync state per user, versioned so a shape change starts clean instead of crashing. */
export function createDeviceCalendarStore(kv: KV) {
  return {
    load(userId: string): DeviceCalendarState {
      const raw = kv.getString(key(userId));
      if (!raw) return { ...EMPTY_STATE };
      try {
        const parsed = JSON.parse(raw) as { v: number; state: DeviceCalendarState & { calendarId?: string | null } };
        if (parsed.v !== VERSION) return { ...EMPTY_STATE };
        // Saved before there was one calendar per type: the single calendar is the task one.
        const { calendarId, ...rest } = parsed.state;
        const calendarIds = { ...EMPTY_STATE.calendarIds, ...(calendarId ? { TASK: calendarId } : {}), ...rest.calendarIds };
        return { ...EMPTY_STATE, ...rest, calendarIds };
      } catch {
        return { ...EMPTY_STATE };
      }
    },
    save(userId: string, state: DeviceCalendarState): void {
      kv.set(key(userId), JSON.stringify({ v: VERSION, state }));
    },
    clear(userId: string): void {
      kv.remove(key(userId));
    },
  };
}
