import { FakeGoogleCalendar } from "./fake-google-calendar";
import {
  divergences,
  planSoak,
  runSoak,
  seeded,
  type SoakEdit,
  type SoakRow,
  type SoakSystem,
} from "./soak-harness";

const START = Date.parse("2026-11-03T02:00:00.000Z");
const event = (id: string, zf: string, startMs = START) => ({
  id,
  summary: "Task",
  extendedProperties: { private: { zf } },
  start: { dateTime: new Date(startMs).toISOString() },
  end: { dateTime: new Date(startMs + 3_600_000).toISOString() },
});

describe("soak harness", () => {
  it("plans the same run for the same seed", () => {
    const a = planSoak({ seed: 7, users: 3, steps: 200 });
    expect(planSoak({ seed: 7, users: 3, steps: 200 })).toEqual(a);
    expect(planSoak({ seed: 8, users: 3, steps: 200 })).not.toEqual(a);
    expect(seeded(1)()).toBe(seeded(1)());
  });

  it("only edits sessions that exist and are not deleted", () => {
    const edits = planSoak({ seed: 11, users: 4, steps: 500 });
    const known = new Map<string, number>();
    for (const e of edits) {
      if (e.op === "create") {
        known.set(e.sessionId, e.user);
        continue;
      }
      expect(known.get(e.sessionId)).toBe(e.user);
      if (e.op === "delete") known.delete(e.sessionId);
    }
    expect(edits.some((e) => e.op === "delete")).toBe(true);
  });

  it("passes when Google and the database agree", () => {
    const google = new FakeGoogleCalendar();
    const cal = "cal-1";
    google.insert(cal, event("aaaa1", "u0-s1"));
    const rows: SoakRow[] = [
      { sessionId: "u0-s1", user: 0, deleted: false, startMs: START },
    ];
    expect(divergences(google, new Map([[0, cal]]), rows)).toEqual([]);
  });

  it("reports duplicates, resurrected sessions, missing events and moved starts", () => {
    const google = new FakeGoogleCalendar();
    const cal = "cal-1";
    google.insert(cal, event("aaaa1", "u0-s1"));
    google.insert(cal, event("aaaa2", "u0-s1"));
    google.insert(cal, event("aaaa3", "u0-s2", START + 3_600_000));
    google.insert(cal, event("aaaa4", "u0-s3"));
    const rows: SoakRow[] = [
      { sessionId: "u0-s1", user: 0, deleted: false, startMs: START },
      { sessionId: "u0-s2", user: 0, deleted: true, startMs: START },
      { sessionId: "u0-s3", user: 0, deleted: false, startMs: START },
      { sessionId: "u0-s4", user: 0, deleted: false, startMs: START },
    ];

    const found = divergences(google, new Map([[0, cal]]), rows);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringContaining("duplicate event for u0-s1"),
        expect.stringContaining("u0-s2 but the session is deleted"),
        expect.stringContaining("u0-s4 is missing from Google"),
      ]),
    );
    expect(found.some((v) => v.includes("u0-s3") && v.includes("start"))).toBe(
      false,
    );
  });

  it("flags a start that differs from the database", () => {
    const google = new FakeGoogleCalendar();
    google.insert("cal-1", event("aaaa1", "u0-s1", START + 60_000));
    const rows: SoakRow[] = [
      { sessionId: "u0-s1", user: 0, deleted: false, startMs: START },
    ];
    expect(divergences(google, new Map([[0, "cal-1"]]), rows)).toEqual([
      "user 0: start of u0-s1 differs from the database",
    ]);
  });

  it("applies and reconciles each edit in order, checking after each", async () => {
    const google = new FakeGoogleCalendar();
    const edits: SoakEdit[] = planSoak({ seed: 3, users: 2, steps: 5 });
    const order: string[] = [];
    const system: SoakSystem = {
      apply: (e) => Promise.resolve(void order.push(`apply ${e.step}`)),
      reconcile: () => Promise.resolve(void order.push("reconcile")),
      rows: () => [],
    };

    expect(await runSoak(system, google, new Map(), edits)).toEqual([]);
    expect(order).toEqual(
      edits.flatMap((e) => [`apply ${e.step}`, "reconcile"]),
    );
  });
});
