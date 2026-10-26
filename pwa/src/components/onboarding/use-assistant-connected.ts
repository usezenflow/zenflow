import { useEffect, useRef, useState } from "react";
import type { ApiAccessResponse } from "@zenflow/shared";
import { getApiAccess } from "@/api/me";
import { listConnectedApps } from "@/api/oauth";

const POLL_MS = 5000;

/**
 * Setup guides plus whether an assistant has connected since this
 * mounted. Same rule as the Settings timeline: only something newer counts.
 */
export function useAssistantConnected(poll: boolean) {
  const [access, setAccess] = useState<ApiAccessResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const seenApps = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [next, linked] = await Promise.all([
          getApiAccess(),
          listConnectedApps(),
        ]);
        if (!active) return;
        seenApps.current ??= new Set(linked.apps.map((a) => a.clientId));
        const newApp = linked.apps.some(
          (a) => !seenApps.current?.has(a.clientId),
        );
        setConnected(newApp);
        setAccess(next);
      } catch {
        // The tiles stay hidden until the guides load.
      }
    }
    void load();
    const id = poll
      ? window.setInterval(() => void load(), POLL_MS)
      : undefined;
    return () => {
      active = false;
      if (id) window.clearInterval(id);
    };
  }, [poll]);

  return { access, connected };
}
