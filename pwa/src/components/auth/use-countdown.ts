import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A single countdown driven off a wall-clock target, so it self-corrects if the
 * timer loop is throttled. Backs the login rate-limit states (request lockout,
 * resend cooldown, verify lockout). Mirrors `mobile/hooks/use-countdown.ts`.
 */
export function useCountdown() {
  const [remaining, setRemaining] = useState(0);
  const targetRef = useRef<number | null>(null);
  const active = remaining > 0;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const target = targetRef.current;
      if (target == null) return;
      setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  const start = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    targetRef.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }, []);

  const clear = useCallback(() => {
    targetRef.current = null;
    setRemaining(0);
  }, []);

  return { remaining, active, start, clear };
}

/** Whole seconds as `m:ss`, e.g. `58` becomes `"0:58"`. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
