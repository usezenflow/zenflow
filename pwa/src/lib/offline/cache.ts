import type { Session, ViewMode } from "@zenflow/shared";
import type { User } from "@/types/user";
import { format, startOfWeek } from "date-fns";
import { clear, createStore, del, entries, get, set } from "idb-keyval";

/**
 * Read-only offline cache for the calendar and the signed-in user (ADR-0034).
 * Calls are best-effort: IndexedDB can be blocked (private windows), and the
 * app works without it.
 */
const store = createStore("zenflow-offline", "entries");

const CALENDAR_PREFIX = "calendar:";
const USER_KEY = "user";
/** Calendar entries kept per device; oldest by `savedAt` go first. */
const MAX_ENTRIES = 160;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedDay {
  sessions: Session[];
  /** When the data was fetched from the server (epoch ms). */
  savedAt: number;
}

/** Key for a view: the day, the Monday of the week, or the month. */
export function cacheKey(view: ViewMode, date: Date): string {
  if (view === "week")
    return `week:${format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd")}`;
  if (view === "month") return `month:${format(date, "yyyy-MM")}`;
  return format(date, "yyyy-MM-dd");
}

export async function readCalendar(
  userId: string,
  key: string,
): Promise<CachedDay | undefined> {
  try {
    return await get<CachedDay>(`${CALENDAR_PREFIX}${userId}:${key}`, store);
  } catch {
    // Storage blocked: the calendar falls back to the network.
    return undefined;
  }
}

export async function writeCalendar(
  userId: string,
  key: string,
  sessions: Session[],
): Promise<void> {
  try {
    const value: CachedDay = { sessions, savedAt: Date.now() };
    await set(`${CALENDAR_PREFIX}${userId}:${key}`, value, store);
    await prune();
  } catch {
    // Storage full or blocked: nothing is saved for offline.
  }
}

async function prune(): Promise<void> {
  const calendar = (await entries<string, CachedDay>(store)).filter(
    ([key]) => String(key).startsWith(CALENDAR_PREFIX),
  );
  const cutoff = Date.now() - MAX_AGE_MS;
  const expired = calendar.filter(([, day]) => day.savedAt < cutoff);
  const newestFirst = calendar
    .filter(([, day]) => day.savedAt >= cutoff)
    .sort((a, b) => b[1].savedAt - a[1].savedAt);
  const drop = [
    ...expired,
    ...newestFirst.slice(MAX_ENTRIES),
  ].map(([key]) => key);
  await Promise.all(drop.map((key) => del(key, store)));
}

export async function readUser(): Promise<User | undefined> {
  try {
    return await get<User>(USER_KEY, store);
  } catch {
    return undefined;
  }
}

export async function writeUser(user: User): Promise<void> {
  try {
    await set(USER_KEY, user, store);
  } catch {
    // Not saved: the next offline start needs a connection to sign in.
  }
}

/** Wipe everything: logout, and a 401 or 403 from the API. */
export async function clearOfflineCache(): Promise<void> {
  try {
    await clear(store);
  } catch {
    // Nothing to wipe if storage is blocked.
  }
}
