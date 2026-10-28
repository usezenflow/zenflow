import { createMMKV } from "react-native-mmkv";
import { createPaletteStore } from "./store";

const mmkv = createMMKV({ id: "zenflow.palette" });

/** MMKV-backed working copy (see `store.ts`); wiped on logout. */
export const paletteDisk = createPaletteStore({
  getString: (k) => mmkv.getString(k),
  set: (k, v) => mmkv.set(k, v),
  remove: (k) => {
    mmkv.remove(k);
  },
  getAllKeys: () => mmkv.getAllKeys(),
});
