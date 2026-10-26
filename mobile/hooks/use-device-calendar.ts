import type { Session } from "@zenflow/shared";
import { addDays, addMonths } from "date-fns";
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { listSessions, updateSession } from "@/api/tasks";
import { putDeviceBusy, setCalendarTarget } from "@/api/device-calendar";
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
/** The server takes at most this many busy blocks in one request. */
const BUSY_MAX = 2000;

type Store = {
  state: DeviceCalendarState;
  syncing: boolean;
  /** Loads the saved state for `userId`. */
  hydrate: (userId: string | null) => void;
  /** Turns the sync on. "denied": the phone refuses access. "failed": the server could not be reached. */
  enable: () => Promise<"ok" | "denied" | "failed">;
  disable: () => Promise<void>;
  /** Syncs now; without `force`, recent syncs are skipped. */
  syncNow: (force?: boolean) => Promise<void>;
};

/** Sends the phone's other busy time, so the scheduler plans around it. Failures wait for the next sync. */
async function uploadBusy(zenflowCalendarId: string | null, now: Date): Promise<void> {
  try {
    const events = await expoCalendarAdapter.listBusy(addDays(now, -BACK_DAYS), addDays(now, AHEAD_DAYS), zenflowCalendarId);
    await putDeviceBusy(
      events.slice(0, BUSY_MAX).map((e) => ({
        externalKey: e.externalKey,
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
      })),
    );
  } catch {
    // Permission revoked or offline: the next sync tries again.
  }
}

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
      try {
        await setCalendarTarget("DEVICE");
      } catch {
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

    syncNow: async (force = false) => {
      const { state, syncing } = get();
      const user = useUserStore.getState().user;
      if (!state.enabled || syncing || !user) return;
      if (!force && state.syncedAt && Date.now() - state.syncedAt < MIN_INTERVAL_MS) return;
      if (!useConnectivity.getState().online) return;

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
        const phone: Record<string, PhoneTimes | null | undefined> = {};
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
              source: "DEVICE",
            });
            moved = true;
          } catch {
            // Rejected (a conflict, or the task changed): Zenflow's time stands.
            links[move.key] = { ...links[move.key], hash: "" };
          }
        }
        for (const reminder of review.reminders) {
          try {
            await updateSession(reminder.key, { reminderMinutes: reminder.minutes, source: "DEVICE" });
            moved = true;
          } catch {
            links[reminder.key] = { ...links[reminder.key], hash: "" };
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
        await uploadBusy(result.state.calendarId, now);
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
