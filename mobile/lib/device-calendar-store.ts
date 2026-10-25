import { createMMKV } from "react-native-mmkv";
import type { KV } from "./session-disk";
import { createDeviceCalendarStore } from "./device-calendar/store";

const mmkv = createMMKV({ id: "zenflow.device-calendar" });

const kv: KV = {
  getString: (k) => mmkv.getString(k),
  set: (k, v) => mmkv.set(k, v),
  remove: (k) => {
    mmkv.remove(k);
  },
  getAllKeys: () => mmkv.getAllKeys(),
};

export const deviceCalendarStore = createDeviceCalendarStore(kv);
