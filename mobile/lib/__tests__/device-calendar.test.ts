import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { buildSpecs, listRanges, noteText, planSync, type PlanContext } from "../device-calendar/plan";
import { createDeviceCalendarStore } from "../device-calendar/store";
import {
  EMPTY_STATE,
  removeDeviceCalendar,
  syncDeviceCalendar,
  type CalendarAdapter,
  type DeviceCalendarState,
} from "../device-calendar/sync";

const ctx: PlanContext = {
  timeZone: "Asia/Ho_Chi_Minh",
  defaultReminderMinutes: 30,
  from: new Date("2026-10-24T00:00:00Z"),
  to: new Date("2026-12-10T00:00:00Z"),
};

const session = (id: string, over: Partial<Session> = {}): Session =>
  ({
    id,
    title: `Task ${id}`,
    type: "TASK",
    scheduledStartTime: "2026-11-03T02:00:00.000Z",
    durationMinutes: 60,
    skipped: false,
    location: null,
    deadline: null,
    ...over,
  }) as Session;

/** A phone calendar in memory, with the failure modes the real one has. */
function fakePhone() {
  const events = new Map<string, { calendarId: string; title: string; startMs: number; endMs: number }>();
  const calendars = new Set<string>();
  let seq = 0;
  const adapter: CalendarAdapter = {
    requestPermission: () => Promise.resolve(true),
    ensureCalendar: (_kind, existing) => {
      if (existing && calendars.has(existing)) return Promise.resolve(existing);
      const id = `cal-${++seq}`;
      calendars.add(id);
      return Promise.resolve(id);
    },
    createEvent: (calendarId, spec) => {
      const id = `ev-${++seq}`;
      events.set(id, { calendarId, title: spec.title, startMs: spec.startDate.getTime(), endMs: spec.endDate.getTime() });
      return Promise.resolve(id);
    },
    updateEvent: (eventId, spec) => {
      const e = events.get(eventId);
      if (!e) return Promise.reject(new Error("gone"));
      e.title = spec.title;
      e.startMs = spec.startDate.getTime();
      e.endMs = spec.endDate.getTime();
      return Promise.resolve();
    },
    listBusy: () => Promise.resolve([]),
    readEvent: (eventId) => {
      const e = events.get(eventId);
      return Promise.resolve(e ? { startMs: e.startMs, endMs: e.endMs } : null);
    },
    deleteEvent: (eventId) => {
      if (!events.delete(eventId)) return Promise.reject(new Error("gone"));
      return Promise.resolve();
    },
    deleteCalendar: (id) => {
      calendars.delete(id);
      for (const [k, e] of events) if (e.calendarId === id) events.delete(k);
      return Promise.resolve();
    },
  };
  return { adapter, events, calendars };
}

const enabled: DeviceCalendarState = { ...EMPTY_STATE, enabled: true };

describe("buildSpecs", () => {
  it("keeps placed, unskipped sessions inside the window", () => {
    const specs = buildSpecs(
      [
        session("a"),
        session("unplaced", { scheduledStartTime: null }),
        session("old", { scheduledStartTime: "2026-01-01T00:00:00.000Z" }),
        session("far", { scheduledStartTime: "2027-03-01T00:00:00.000Z" }),
      ],
      ctx,
    );
    expect(specs.map((s) => s.key)).toEqual(["a"]);
    expect(specs[0].endDate.toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(specs[0].alarmMinutes).toBe(30);
  });

  it("gives DND no alarm and a task its due line", () => {
    const [dnd] = buildSpecs([session("d", { type: "DND" })], ctx);
    expect(dnd.alarmMinutes).toBe(0);
    const [task] = buildSpecs([session("t", { deadline: "2026-11-06T16:59:00.000Z" })], ctx);
    expect(task.notes).toMatch(/^Due /);
  });

  it("sends exams and assignments to their own calendar without a title prefix", () => {
    const specs = buildSpecs(
      [session("e", { type: "EXAM", title: "Calc" }), session("a", { type: "ASSIGNMENT", title: "Essay" }), session("t", { title: "Read" })],
      ctx,
    );
    expect(specs.map((s) => [s.kind, s.title])).toEqual([["EXAM", "Calc"], ["ASSIGNMENT", "Essay"], ["TASK", "Read"]]);
  });

  it("changes the hash with anything the phone shows", () => {
    const hash = (over: Partial<Session>) => buildSpecs([session("a", over)], ctx)[0].hash;
    const base = hash({});
    expect(hash({})).toBe(base);
    expect(hash({ title: "Renamed" })).not.toBe(base);
    expect(hash({ scheduledStartTime: "2026-11-03T03:00:00.000Z" })).not.toBe(base);
    expect(hash({ location: "A305" })).not.toBe(base);
  });
});

describe("planSync", () => {
  it("leaves past events alone but removes ones that left the schedule inside the window", () => {
    const links = {
      past: { eventId: "e1", hash: "x", startMs: new Date("2026-01-01T00:00:00Z").getTime() },
      gone: { eventId: "e2", hash: "x", startMs: new Date("2026-11-05T00:00:00Z").getTime() },
    };
    expect(planSync([], links, ctx).remove).toEqual([{ key: "gone", eventId: "e2" }]);
  });
});

describe("syncDeviceCalendar", () => {
  it("moves a legacy exam event out of the task calendar", async () => {
    const phone = fakePhone();
    const first = await syncDeviceCalendar(phone.adapter, enabled, [session("x", { type: "EXAM" })], ctx);
    const legacy = { ...first.state, links: { x: { ...first.state.links.x, kind: undefined } } };
    const next = await syncDeviceCalendar(phone.adapter, legacy, [session("x", { type: "EXAM" })], ctx);

    expect(next).toMatchObject({ created: 1, failed: 0 });
    expect(phone.events.size).toBe(1);
    expect(next.state.links.x.kind).toBe("EXAM");
  });

  it("creates the calendar and an event per session", async () => {
    const phone = fakePhone();
    const res = await syncDeviceCalendar(phone.adapter, enabled, [session("a"), session("b")], ctx, 1000);

    expect(res).toMatchObject({ created: 2, updated: 0, removed: 0, failed: 0 });
    expect(phone.events.size).toBe(2);
    expect(res.state.calendarIds.TASK).toBe("cal-1");
    expect(Object.keys(res.state.links).sort()).toEqual(["a", "b"]);
    expect(res.state.syncedAt).toBe(1000);
  });

  it("writes nothing on a repeat run", async () => {
    const phone = fakePhone();
    const first = await syncDeviceCalendar(phone.adapter, enabled, [session("a")], ctx);
    const second = await syncDeviceCalendar(phone.adapter, first.state, [session("a")], ctx);

    expect(second).toMatchObject({ created: 0, updated: 0, removed: 0 });
  });

  it("updates a changed session and removes one that was cancelled", async () => {
    const phone = fakePhone();
    const first = await syncDeviceCalendar(phone.adapter, enabled, [session("a"), session("b")], ctx);

    const next = await syncDeviceCalendar(
      phone.adapter,
      first.state,
      [session("a", { title: "Renamed" })],
      ctx,
    );

    expect(next).toMatchObject({ created: 0, updated: 1, removed: 1 });
    expect([...phone.events.values()].map((e) => e.title)).toEqual(["Renamed"]);
    expect(Object.keys(next.state.links)).toEqual(["a"]);
  });

  it("recreates an event the user deleted on the phone", async () => {
    const phone = fakePhone();
    const first = await syncDeviceCalendar(phone.adapter, enabled, [session("a")], ctx);
    phone.events.clear();

    const next = await syncDeviceCalendar(phone.adapter, first.state, [session("a", { title: "Moved" })], ctx);

    expect(next).toMatchObject({ created: 1, updated: 0, failed: 0 });
    expect(phone.events.size).toBe(1);
  });

  it("starts over when the whole calendar was deleted on the phone", async () => {
    const phone = fakePhone();
    const first = await syncDeviceCalendar(phone.adapter, enabled, [session("a")], ctx);
    phone.calendars.clear();
    phone.events.clear();

    const next = await syncDeviceCalendar(phone.adapter, first.state, [session("a")], ctx);

    expect(next.created).toBe(1);
    expect(next.state.calendarIds.TASK).not.toBe(first.state.calendarIds.TASK);
  });

  it("keeps going when one event fails", async () => {
    const phone = fakePhone();
    const original = phone.adapter.createEvent;
    phone.adapter.createEvent = (c, spec) =>
      spec.key === "bad" ? Promise.reject(new Error("denied")) : original(c, spec);

    const res = await syncDeviceCalendar(phone.adapter, enabled, [session("bad"), session("ok")], ctx);

    expect(res).toMatchObject({ created: 1, failed: 1 });
    expect(Object.keys(res.state.links)).toEqual(["ok"]);
  });

  it("removes the calendar and resets the state", async () => {
    const phone = fakePhone();
    const first = await syncDeviceCalendar(phone.adapter, enabled, [session("a")], ctx);

    const cleared = await removeDeviceCalendar(phone.adapter, first.state);

    expect(cleared).toEqual(EMPTY_STATE);
    expect(phone.events.size).toBe(0);
    expect(phone.calendars.size).toBe(0);
  });
});

describe("device calendar store", () => {
  function memoryKv() {
    const data = new Map<string, string>();
    return {
      getString: (k: string) => data.get(k),
      set: (k: string, v: string) => void data.set(k, v),
      remove: (k: string) => void data.delete(k),
      getAllKeys: () => [...data.keys()],
      data,
    };
  }

  it("keeps state per user", () => {
    const store = createDeviceCalendarStore(memoryKv());
    store.save("u1", { ...EMPTY_STATE, enabled: true, calendarIds: { ...EMPTY_STATE.calendarIds, TASK: "cal-1" } });

    expect(store.load("u1").calendarIds.TASK).toBe("cal-1");
    expect(store.load("u2")).toEqual(EMPTY_STATE);
    store.clear("u1");
    expect(store.load("u1")).toEqual(EMPTY_STATE);
  });

  it("starts clean on an unknown version or corrupt value", () => {
    const kv = memoryKv();
    kv.set("device-calendar:u1", JSON.stringify({ v: 99, state: { enabled: true } }));
    kv.set("device-calendar:u2", "{not json");
    const store = createDeviceCalendarStore(kv);

    expect(store.load("u1")).toEqual(EMPTY_STATE);
    expect(store.load("u2")).toEqual(EMPTY_STATE);
  });
});

describe("listRanges", () => {
  it("covers the window in requests of at most 30 days", () => {
    const from = new Date("2026-10-25T10:00:00Z");
    const to = new Date("2026-12-09T10:00:00Z");
    const ranges = listRanges(from, to, 30);
    expect(ranges).toHaveLength(2);
    expect(ranges[0][0]).toEqual(from);
    expect(ranges[1][1]).toEqual(to);
    for (const [a, b] of ranges) expect((b.getTime() - a.getTime()) / 86_400_000).toBeLessThan(30);
    expect(ranges[1][0].getTime()).toBeGreaterThan(ranges[0][1].getTime());
  });
});

describe("noteText", () => {
  it("turns LMS html into plain text", () => {
    expect(noteText("<p>Read <b>ch. 3</b> &amp; reply</p><p>Bring ID</p>")).toBe("Read ch. 3 & reply\nBring ID");
    expect(noteText(null)).toBe("");
  });
});
