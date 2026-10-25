import type { Session } from "@zenflow/shared";
import { addDays, addMonths } from "date-fns";
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { listSessions } from "@/api/tasks";
import { useConnectivity } from "@/lib/connectivity";
import { expoCalendarAdapter } from "@/lib/device-calendar/expo-adapter";
import {
  EMPTY_STATE,
  removeDeviceCalendar,
  syncDeviceCalendar,
  type DeviceCalendarState,
} from "@/lib/device-calendar/sync";
import { deviceCalendarStore } from "@/lib/device-calendar-store";
import { subscribeToSessionMutations } from "@/lib/session-cache";
import { useUserStore } from "@/hooks/use-user-store";

const BACK_DAYS = 1;
const AHEAD_DAYS = 45;
/** Foreground syncs closer together than this are skipped. */
const MIN_INTERVAL_MS = 2 * 60_000;
/** Edits arrive in bursts; sync once after they settle. */
const EDIT_DEBOUNCE_MS = 3_000;

type Store = {
  state: DeviceCalendarState;
  syncing: boolean;
  /** Loads the saved state for `userId`. */
  hydrate: (userId: string | null) => void;
  /** Turns the sync on. Resolves "denied" when the phone refuses access. */
  enable: () => Promise<"ok" | "denied">;
  disable: () => Promise<void>;
  /** Syncs now; without `force`, recent syncs are skipped. */
  syncNow: (force?: boolean) => Promise<void>;
};

/** This month and the next, deduped: enough to cover the sync window. */
async function fetchWindow(now: Date): Promise<Session[]> {
  const pages = await Promise.all([listSessions("month", now), listSessions("month", addMonths(now, 1))]);
  const byId = new Map<string, Session>();
  for (const page of pages) for (const s of page.sessions) byId.set(s.id, s);
  return [...byId.values()];
}

export const useDeviceCalendar = create<Store>((set, get) => {
  const userId = () => useUserStore.getState().user?.id ?? null;
  const persist = (state: DeviceCalendarState) => {
    const id = userId();
    if (id) deviceCalendarStore.save(id, state);
    set({ state });
  };

  return {
    state: { ...EMPTY_STATE },
    syncing: false,

    hydrate: (id) => set({ state: id ? deviceCalendarStore.load(id) : { ...EMPTY_STATE } }),

    enable: async () => {
      if (!(await expoCalendarAdapter.requestPermission())) return "denied";
      persist({ ...get().state, enabled: true });
      await get().syncNow(true);
      return "ok";
    },

    disable: async () => {
      persist(await removeDeviceCalendar(expoCalendarAdapter, get().state));
    },

    syncNow: async (force = false) => {
      const { state, syncing } = get();
      const user = useUserStore.getState().user;
      if (!state.enabled || syncing || !user) return;
      if (!force && state.syncedAt && Date.now() - state.syncedAt < MIN_INTERVAL_MS) return;
      if (!useConnectivity.getState().online) return;

      set({ syncing: true });
      try {
        const now = new Date();
        const sessions = await fetchWindow(now);
        const result = await syncDeviceCalendar(expoCalendarAdapter, get().state, sessions, {
          timeZone: user.timezone,
          from: addDays(now, -BACK_DAYS),
          to: addDays(now, AHEAD_DAYS),
        });
        persist(result.state);
      } catch {
        // Offline or permission revoked: the next trigger tries again.
      } finally {
        set({ syncing: false });
      }
    },
  };
});

/** Keeps the phone calendar current: on launch, on return to the app and after edits. */
export function useDeviceCalendarSync(): void {
  const userId = useUserStore((s) => s.user?.id ?? null);

  useEffect(() => {
    const { hydrate, syncNow } = useDeviceCalendar.getState();
    hydrate(userId);
    if (!userId) return;
    void syncNow();

    const app = AppState.addEventListener("change", (status) => {
      if (status === "active") void syncNow();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const edits = subscribeToSessionMutations(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(true), EDIT_DEBOUNCE_MS);
    });
    return () => {
      app.remove();
      edits();
      clearTimeout(timer);
    };
  }, [userId]);
}
