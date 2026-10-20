import { listSessions, recordSessionStart } from "@/api/tasks";
import { isInPlacedBlock } from "@/lib/placed-block";
import { subscribeToSessionMutations } from "@/lib/session-cache";
import type { Session } from "@zenflow/shared";
import { zonedNow } from "@zenflow/core";
import { AppState } from "react-native";
import { useEffect } from "react";
import { create } from "zustand";

interface TodayState {
  /** Today's sessions, or `null` until the first load. */
  sessions: Session[] | null;
}

/** Shared state for the Today card. */
export const useTodayStore = create<TodayState>(() => ({
  sessions: null,
}));

/**
 * Loads today's sessions while mounted, and reloads on every
 * session mutation. Failures keep the last good data.
 */
export function useTodayLoader(tz: string): void {
  useEffect(() => {
    let alive = true;
    const load = () => {
      listSessions("day", zonedNow(tz))
        .then((res) => {
          if (alive) useTodayStore.setState({ sessions: res.sessions });
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = subscribeToSessionMutations(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [tz]);
}

/**
 * Records that the app is open inside a placed task's slot. Checked when the
 * Today data changes, on every return to the foreground, and each minute, so a
 * block that starts while the app is open is caught too.
 */
export function useBlockStartRecorder(): void {
  useEffect(() => {
    const sent = new Set<string>();
    const check = () => {
      const now = Date.now();
      for (const s of useTodayStore.getState().sessions ?? []) {
        if (sent.has(s.id) || !isInPlacedBlock(s, now)) continue;
        sent.add(s.id);
        recordSessionStart(s.id).catch(() => sent.delete(s.id));
      }
    };
    check();
    const unsubscribe = useTodayStore.subscribe(check);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    const timer = setInterval(check, 60_000);
    return () => {
      unsubscribe();
      appState.remove();
      clearInterval(timer);
    };
  }, []);
}
