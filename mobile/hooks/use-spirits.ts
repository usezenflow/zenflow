import { getSpirits, hatchEgg } from "@/api/spirits";
import type { SpiritHatchResponse, SpiritsResponse } from "@zenflow/shared";
import { create } from "zustand";

interface SpiritsState {
  /** The last overview, or `null` until the first load. */
  data: SpiritsResponse | null;
  loading: boolean;
  error: boolean;
  load: () => Promise<void>;
  /** Hatches the ready egg, then reloads the overview. Throws when the hatch fails. */
  hatch: () => Promise<SpiritHatchResponse>;
}

/** Shared spirit state: the Spirits tab and the list's companion read the same overview. */
export const useSpiritsStore = create<SpiritsState>((set, get) => ({
  data: null,
  loading: false,
  error: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const data = await getSpirits();
      set({ data, error: false });
    } catch {
      set({ error: true });
    } finally {
      set({ loading: false });
    }
  },
  hatch: async () => {
    const egg = get().data?.egg;
    if (!egg || egg.status !== "ready") throw new Error("Egg is not ready");
    const result = await hatchEgg(egg.id);
    await get().load();
    return result;
  },
}));
