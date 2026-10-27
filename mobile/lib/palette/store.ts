import { emptyState, type PaletteState } from "./history";
import type { KV } from "../session-disk";

const ROOT = "zf.palette.";

/** Working copy in a KV (MMKV on device), one key per user, wiped on logout. */
export function createPaletteStore(kv: KV) {
  return {
    load(userId: string): PaletteState {
      try {
        const raw = kv.getString(ROOT + userId);
        return raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState();
      } catch {
        return emptyState();
      }
    },
    save: (userId: string, state: PaletteState) =>
      kv.set(ROOT + userId, JSON.stringify(state)),
    clear() {
      for (const k of kv.getAllKeys()) if (k.startsWith(ROOT)) kv.remove(k);
    },
  };
}
