import type { Session } from "@zenflow/shared";
import { Trie } from "./trie";

export interface TitleStat {
  count: number;
  lastUsed: number;
  /** Most recent lengths in minutes, newest last. */
  minutes: number[];
}
export interface PlaceStat {
  count: number;
  lastUsed: number;
}
export interface PaletteState {
  titles: Record<string, TitleStat>;
  places: Record<string, PlaceStat>;
  /** Confirmed edits: `change` and `title|change` keys (see edits.ts). */
  edits: Record<string, PlaceStat>;
}

const MAX_MINUTES = 9;
const MAX_KEYS = 500;
const key = (s: string) => s.trim().toLowerCase();

const tries = new WeakMap<PaletteState, Trie>();

export const emptyState = (): PaletteState => ({
  titles: {},
  places: {},
  edits: {},
});

/** Counts one use of a title, its length and place. Mutates `state`. */
export function record(
  state: PaletteState,
  use: { title: string; durationMinutes: number; location?: string | null },
  at: number,
): void {
  tries.delete(state);
  const t = (state.titles[key(use.title)] ??= {
    count: 0,
    lastUsed: 0,
    minutes: [],
  });
  t.count++;
  t.lastUsed = Math.max(t.lastUsed, at);
  t.minutes = [...t.minutes, use.durationMinutes].slice(-MAX_MINUTES);
  if (use.location) {
    const p = (state.places[use.location] ??= { count: 0, lastUsed: 0 });
    p.count++;
    p.lastUsed = Math.max(p.lastUsed, at);
  }
}

/** Counts one confirmed edit overall and for each title it touched. Mutates `state`. */
export function recordEdit(
  state: PaletteState,
  change: string,
  titles: string[],
  at: number,
): void {
  for (const k of [change, ...titles.map((t) => `${key(t)}|${change}`)]) {
    const e = (state.edits[k] ??= { count: 0, lastUsed: 0 });
    e.count++;
    e.lastUsed = Math.max(e.lastUsed, at);
  }
}

/** First launch: learn from the server's existing sessions. */
export function seed(sessions: Session[], at: number): PaletteState {
  const state = emptyState();
  for (const s of sessions)
    record(
      state,
      {
        title: s.title,
        durationMinutes: s.durationMinutes,
        location: s.location,
      },
      at,
    );
  return state;
}

/** The title's median length, rounded to 15 minutes. */
export function medianMinutes(
  state: PaletteState,
  title: string,
): number | undefined {
  const m = [...(state.titles[key(title)]?.minutes ?? [])].sort(
    (a, b) => a - b,
  );
  if (!m.length) return undefined;
  return Math.max(15, Math.round(m[Math.floor(m.length / 2)] / 15) * 15);
}

/** Most used titles, newest first on a tie; what to offer before anything is typed. */
export function topTitles(state: PaletteState, limit = 5): string[] {
  return Object.entries(state.titles)
    .filter(([k]) => k)
    .sort(([, a], [, b]) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map(([k]) => k);
}

/** Titles and places starting with `prefix`, most used then newest first. */
export function complete(
  state: PaletteState,
  prefix: string,
  limit = 5,
): string[] {
  let trie = tries.get(state);
  if (!trie) {
    trie = new Trie();
    // Rank: use count first, then recency as a fraction so it never outweighs a count.
    for (const stats of [state.titles, state.places])
      for (const [k, v] of Object.entries(stats))
        trie.insert(k, v.count + v.lastUsed / 1e15);
    tries.set(state, trie);
  }
  return trie.complete(prefix, limit);
}

const mergeStats = <T extends { count: number; lastUsed: number }>(
  a: Record<string, T>,
  b: Record<string, T>,
  join: (x: T, y: T) => T,
) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = out[k] ? join(out[k], v) : v;
  return out;
};

/** Union: counts max, newest `lastUsed`, newest lengths of the busier side. */
export function merge(a: PaletteState, b: PaletteState): PaletteState {
  const base = (
    x: { count: number; lastUsed: number },
    y: { count: number; lastUsed: number },
  ) => ({
    count: Math.max(x.count, y.count),
    lastUsed: Math.max(x.lastUsed, y.lastUsed),
  });
  const merged: PaletteState = {
    titles: mergeStats(a.titles, b.titles, (x, y) => ({
      ...base(x, y),
      minutes: (x.count >= y.count ? x : y).minutes,
    })),
    places: mergeStats(a.places, b.places, base),
    edits: mergeStats(a.edits ?? {}, b.edits ?? {}, base),
  };
  for (const k of ["titles", "places", "edits"] as const) {
    const entries = Object.entries(merged[k])
      .sort(([, x], [, y]) => y.lastUsed - x.lastUsed)
      .slice(0, MAX_KEYS);
    (merged[k] as Record<string, unknown>) = Object.fromEntries(entries);
  }
  return merged;
}
