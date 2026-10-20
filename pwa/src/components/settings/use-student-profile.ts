import { useEffect, useState } from "react";
import { getStudent } from "@/api/student";
import type { StudentProfileDto } from "@zenflow/shared";

/** How often to look again while the profile is still being fetched. */
const POLL_MS = 8_000;
const MAX_POLLS = 8;

/**
 * The DLU student profile. It arrives from a background job after the portal
 * connects, so while it is missing (or marks are unsynced) this checks a few
 * more times and then stops. `enabled` is false when no portal is connected.
 */
export function useStudentProfile(enabled: boolean): StudentProfileDto | null {
  const [profile, setProfile] = useState<StudentProfileDto | null>(null);

  useEffect(() => {
    if (!enabled) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const { profile: next } = await getStudent();
        if (cancelled) return;
        setProfile(next);
        const settled = next !== null && next.marksFetchedAt !== null;
        if (!settled && polls < MAX_POLLS) {
          polls += 1;
          timer = setTimeout(load, POLL_MS);
        }
      } catch {
        // The card stays hidden when the profile cannot be read.
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return profile;
}
