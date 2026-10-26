import type { FakeGoogleCalendar } from "./fake-google-calendar";

/**
 * Soak harness for calendar sync: a seeded stream of edits from Google, the
 * phone and MCP, checked against invariants after every reconcile. The
 * system under test is injected, so the same planner and checker serve the
 * unit tests and the nightly run.
 */

export type EditSource = "mcp" | "google" | "phone";

export type SoakEdit =
  | {
      step: number;
      user: number;
      source: "mcp";
      op: "create";
      sessionId: string;
      startMinutes: number;
    }
  | {
      step: number;
      user: number;
      source: EditSource;
      op: "move";
      sessionId: string;
      startMinutes: number;
    }
  | {
      step: number;
      user: number;
      source: EditSource;
      op: "delete";
      sessionId: string;
    }
  | {
      step: number;
      user: number;
      source: EditSource;
      op: "remind";
      sessionId: string;
      minutes: number;
    };

/** What the database says a session is, as far as sync is concerned. */
export interface SoakRow {
  sessionId: string;
  user: number;
  deleted: boolean;
  startMs: number;
}

export interface SoakSystem {
  apply(edit: SoakEdit): Promise<void>;
  reconcile(): Promise<void>;
  rows(): SoakRow[];
}

/** Small seeded PRNG (mulberry32): the same seed always plans the same run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plans `steps` edits over `users` users. Only sessions that exist are moved,
 * deleted or reminded, so every planned edit is one a real user could make.
 */
export function planSoak(opts: {
  seed: number;
  users: number;
  steps: number;
}): SoakEdit[] {
  const rnd = seeded(opts.seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const live = new Map<number, string[]>();
  let created = 0;
  const edits: SoakEdit[] = [];

  for (let step = 0; step < opts.steps; step++) {
    const user = Math.floor(rnd() * opts.users);
    const sessions = live.get(user) ?? [];
    const roll = rnd();
    if (sessions.length === 0 || roll < 0.2) {
      const sessionId = `u${user}-s${++created}`;
      sessions.push(sessionId);
      live.set(user, sessions);
      edits.push({
        step,
        user,
        source: "mcp",
        op: "create",
        sessionId,
        startMinutes: Math.floor(rnd() * 480),
      });
    } else if (roll < 0.5) {
      const sessionId = pick(sessions);
      const source = pick<EditSource>(["mcp", "google", "phone"]);
      edits.push({
        step,
        user,
        source,
        op: "move",
        sessionId,
        startMinutes: Math.floor(rnd() * 480),
      });
    } else if (roll < 0.7) {
      const sessionId = pick(sessions);
      const source = pick<EditSource>(["mcp", "google", "phone"]);
      edits.push({ step, user, source, op: "delete", sessionId });
      live.set(
        user,
        sessions.filter((s) => s !== sessionId),
      );
    } else {
      const sessionId = pick(sessions);
      const source = pick<EditSource>(["google", "phone"]);
      edits.push({
        step,
        user,
        source,
        op: "remind",
        sessionId,
        minutes: pick([0, 5, 10, 15, 30, 60]),
      });
    }
  }
  return edits;
}

/**
 * Compares Google with the database and returns one message per violation:
 * duplicate events for a session, events for deleted or unknown sessions,
 * sessions missing from Google, and start times that disagree.
 */
export function divergences(
  google: FakeGoogleCalendar,
  calendars: Map<number, string>,
  rows: SoakRow[],
): string[] {
  const violations: string[] = [];
  const byId = new Map(rows.map((r) => [r.sessionId, r]));
  for (const [user, calendarId] of calendars) {
    const seen = new Map<string, Record<string, unknown>>();
    for (const event of google.liveEvents(calendarId)) {
      const zf = (
        event.extendedProperties as { private?: { zf?: string } } | undefined
      )?.private?.zf;
      if (!zf) continue;
      if (seen.has(zf))
        violations.push(`user ${user}: duplicate event for ${zf}`);
      seen.set(zf, event);
      const row = byId.get(zf);
      if (!row || row.user !== user || row.deleted) {
        violations.push(
          `user ${user}: event for ${zf} but the session is ${row ? (row.deleted ? "deleted" : "elsewhere") : "unknown"}`,
        );
        continue;
      }
      const start = Date.parse(
        String((event.start as { dateTime?: string }).dateTime),
      );
      if (start !== row.startMs)
        violations.push(
          `user ${user}: start of ${zf} differs from the database`,
        );
    }
    for (const row of rows) {
      if (row.user === user && !row.deleted && !seen.has(row.sessionId))
        violations.push(
          `user ${user}: ${row.sessionId} is missing from Google`,
        );
    }
  }
  return violations;
}

/** Runs the plan one edit at a time, reconciling and checking after each. Returns violations tagged with their step. */
export async function runSoak(
  system: SoakSystem,
  google: FakeGoogleCalendar,
  calendars: Map<number, string>,
  edits: SoakEdit[],
): Promise<string[]> {
  const violations: string[] = [];
  for (const edit of edits) {
    await system.apply(edit);
    await system.reconcile();
    for (const v of divergences(google, calendars, system.rows()))
      violations.push(`step ${edit.step}: ${v}`);
  }
  return violations;
}
