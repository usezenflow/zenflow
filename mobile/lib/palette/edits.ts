import type { Session, UpdateSessionInput } from "@zenflow/shared";
import { addDays } from "date-fns";
import { t } from "@/lib/i18n";
import type { PaletteState } from "./history";

/** A one tap change. `id` is what history learns; `patch` runs per target so shifts stay relative. */
export interface Change {
  id: string;
  label: string;
  patch: (s: Session, now: Date) => UpdateSessionInput;
}

const start = (s: Session, now: Date) => new Date(s.scheduledStartTime ?? now);
const shift =
  (days: number) =>
  (s: Session, now: Date): UpdateSessionInput => ({
    scheduledStartTime: addDays(start(s, now), days).toISOString(),
  });
const part =
  (w: "MORNING" | "AFTERNOON" | "EVENING"): Change["patch"] =>
  () => ({ window: w });

export const CHANGES: Change[] = [
  { id: "shift:1d", label: "+1 day", patch: shift(1) },
  { id: "shift:1w", label: "+1 week", patch: shift(7) },
  { id: "shift:-1d", label: "-1 day", patch: shift(-1) },
  {
    id: "later:2h",
    label: "Later today",
    patch: (s, now) => ({
      scheduledStartTime: new Date(
        Math.max(start(s, now).getTime(), now.getTime()) + 2 * 3_600_000,
      ).toISOString(),
    }),
  },
  {
    id: "resize:+30",
    label: "+30 min",
    patch: (s) => ({ durationMinutes: s.durationMinutes + 30 }),
  },
  {
    id: "resize:-30",
    label: "-30 min",
    patch: (s) => ({ durationMinutes: Math.max(15, s.durationMinutes - 30) }),
  },
  { id: "window:MORNING", label: "Morning", patch: part("MORNING") },
  { id: "window:AFTERNOON", label: "Afternoon", patch: part("AFTERNOON") },
  { id: "window:EVENING", label: "Evening", patch: part("EVENING") },
];

/** Shown when nothing has been learned yet. */
const DEFAULTS = ["shift:1d", "later:2h", "resize:+30", "window:MORNING"];

export const labelOf = (c: Change) => t(c.label);

/** Top changes for these targets: this title's history first, then overall, then the defaults. */
export function rankChanges(
  state: PaletteState,
  titles: string[],
  limit = 4,
): Change[] {
  const edits = state.edits ?? {};
  const score = (id: string) => {
    const own = titles.reduce(
      (n, title) =>
        n + (edits[`${title.trim().toLowerCase()}|${id}`]?.count ?? 0),
      0,
    );
    const all = edits[id]?.count ?? 0;
    return own * 10 + all;
  };
  const learned = CHANGES.filter((c) => score(c.id) > 0).sort(
    (a, b) => score(b.id) - score(a.id),
  );
  const rest = DEFAULTS.map((id) => CHANGES.find((c) => c.id === id)!).filter(
    (c) => !learned.includes(c),
  );
  return [...learned, ...rest].slice(0, limit);
}
