import type { Session } from "@zenflow/shared";
import { addDays, addMonths } from "date-fns";
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { listSessions, updateSession } from "@/api/tasks";
import { getGoogleCalendar, setCalendarTarget } from "@/api/google-calendar";
import { useConnectivity } from "@/lib/connectivity";
import { expoCalendarAdapter } from "@/lib/device-calendar/expo-adapter";
import { reviewDeviceEvents, type PhoneTimes } from "@/lib/device-calendar/moves";
import type { DeviceLinks } from "@/lib/device-calendar/plan";
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
  /** True while Google Calendar is the user's target, so the phone calendar can't be on. */
  googleOwned: boolean;
  /** Loads the saved state for `userId`. */
  hydrate: (userId: string | null) => void;
  /**
   * Turns the sync on. "denied": the phone refuses access. "google": Google
   * Calendar is connected. "failed": the server could not be reached.
   */
  enable: () => Promise<"ok" | "denied" | "google" | "failed">;
  disable: () => Promise<void>;
  /** Matches the phone to the server's target; true when the phone sync may run. */
  reconcile: () => Promise<boolean>;
  /** Syncs now; without `force`, recent syncs are skipped. */
  syncNow: (force?: boolean) => Promise<void>;
};

/** The server refuses a target that is taken by the other calendar (409). */
const isConflict = (error: unknown) => (error as { response?: { status?: number } }).response?.status === 409;

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
    googleOwned: false,

    hydrate: (id) => set({ state: id ? deviceCalendarStore.load(id) : { ...EMPTY_STATE } }),

    enable: async () => {
      if (get().googleOwned) return "google";
      if (!(await expoCalendarAdapter.requestPermission())) return "denied";
      try {
        await setCalendarTarget("DEVICE");
      } catch (error) {
        if (isConflict(error)) {
          set({ googleOwned: true });
          return "google";
        }
        return "failed";
      }
      persist({ ...get().state, enabled: true });
      await get().syncNow(true);
      return "ok";
    },

    disable: async () => {
      persist(await removeDeviceCalendar(expoCalendarAdapter, get().state));
      await setCalendarTarget("NONE").catch(() => undefined);
    },

    reconcile: async () => {
      let status;
      try {
        status = await getGoogleCalendar();
      } catch {
        // Offline: keep what the phone has and check again on the next sync.
        return get().state.enabled && !get().googleOwned;
      }
      if (status.target === "GOOGLE") {
        set({ googleOwned: true });
        if (get().state.enabled) persist(await removeDeviceCalendar(expoCalendarAdapter, get().state));
        return false;
      }
      set({ googleOwned: false });
      // The phone calendar was on before the server knew about it: claim it rather than switch it off.
      if (get().state.enabled && status.target !== "DEVICE") {
        await setCalendarTarget("DEVICE").catch(() => undefined);
      }
      return get().state.enabled;
    },

    syncNow: async (force = false) => {
      const { state, syncing } = get();
      const user = useUserStore.getState().user;
      if (!state.enabled || syncing || !user) return;
      if (!force && state.syncedAt && Date.now() - state.syncedAt < MIN_INTERVAL_MS) return;
      if (!useConnectivity.getState().online) return;
      if (!(await get().reconcile())) return;

      set({ syncing: true });
      try {
        const now = new Date();
        const ctx = {
          timeZone: user.timezone,
          defaultReminderMinutes: user.defaultReminderMinutes,
          from: addDays(now, -BACK_DAYS),
          to: addDays(now, AHEAD_DAYS),
        };
        const before = get().state;
        let sessions = await fetchWindow(now);

        // Edits made on the phone come back first: a moved task is a MOVE the
        // server records. Everything else the phone changed is rewritten.
        const links: DeviceLinks = { ...before.links };
        const entries = Object.values(before.links);
        const times = await Promise.all(
          entries.map((link) => expoCalendarAdapter.readEvent(link.eventId)),
        );
        const phone: Record<string, PhoneTimes | null> = {};
        entries.forEach((link, i) => {
          phone[link.eventId] = times[i];
        });
        const review = reviewDeviceEvents(
          links,
          phone,
          new Map(sessions.map((session) => [session.id, session])),
        );
        for (const key of review.restore) links[key] = { ...links[key], hash: "" };
        let moved = false;
        for (const move of review.moves) {
          try {
            await updateSession(move.key, {
              scheduledStartTime: new Date(move.startMs).toISOString(),
              durationMinutes: move.durationMinutes,
            });
            moved = true;
          } catch {
            // Rejected (a conflict, or the task changed): Zenflow's time stands.
            links[move.key] = { ...links[move.key], hash: "" };
          }
        }
        if (moved) sessions = await fetchWindow(now);

        const result = await syncDeviceCalendar(
          expoCalendarAdapter,
          { ...before, links },
          sessions,
          ctx,
        );
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
