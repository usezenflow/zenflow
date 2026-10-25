import type { KV } from "./session-disk";
import { createDeviceCalendarStore } from "./device-calendar/store";

/** Web has no phone calendar; the same interface over nothing. */
const empty: KV = {
  getString: () => undefined,
  set: () => {},
  remove: () => {},
  getAllKeys: () => [],
};

export const deviceCalendarStore = createDeviceCalendarStore(empty);
