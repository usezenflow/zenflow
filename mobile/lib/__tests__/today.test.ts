import { buildToday } from "@zenflow/core";
import type { Session, SessionType } from "@zenflow/shared";
import { describe, expect, it } from "vitest";

const TZ = "UTC";
const NOW = new Date("2026-10-23T09:00:00Z");

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    title: overrides.id,
    type: "TASK" as SessionType,
    scheduledStartTime: "2026-10-23T10:00:00Z",
    durationMinutes: 60,
    skipped: false,
    ...overrides,
  } as Session;
}

describe("buildToday", () => {
  it("picks the earliest open session today as next", () => {
    const view = buildToday(
      [
        session({ id: "late", scheduledStartTime: "2026-10-23T14:00:00Z" }),
        session({ id: "early", scheduledStartTime: "2026-10-23T10:00:00Z" }),
      ],
      NOW,
      TZ,
    );
    expect(view.next?.id).toBe("early");
    expect(view.later.map((s) => s.id)).toEqual(["late"]);
  });

  it("keeps an in-progress session as next until it ends", () => {
    const view = buildToday(
      [session({ id: "now", scheduledStartTime: "2026-10-23T08:30:00Z", durationMinutes: 60 })],
      NOW,
      TZ,
    );
    expect(view.next?.id).toBe("now");
  });

  it("drops a session once it has ended", () => {
    const view = buildToday(
      [session({ id: "over", scheduledStartTime: "2026-10-23T07:00:00Z", durationMinutes: 60 })],
      NOW,
      TZ,
    );
    expect(view.next).toBeNull();
  });

  it("ignores skipped sessions", () => {
    const view = buildToday([session({ id: "skip", skipped: true })], NOW, TZ);
    expect(view.next).toBeNull();
    expect(view.later).toEqual([]);
  });

  it("ignores DND blocks", () => {
    const view = buildToday([session({ id: "dnd", type: "DND" })], NOW, TZ);
    expect(view.next).toBeNull();
  });

  it("ignores unplaced tasks", () => {
    const view = buildToday([session({ id: "unplaced", scheduledStartTime: null })], NOW, TZ);
    expect(view.next).toBeNull();
  });

  it("ignores sessions on other days in the user's timezone", () => {
    const view = buildToday(
      [session({ id: "tomorrow", scheduledStartTime: "2026-10-24T10:00:00Z" })],
      NOW,
      TZ,
    );
    expect(view.next).toBeNull();
  });

  it("uses the user's timezone to decide the day", () => {
    // 23:30 UTC on the 22nd is already the 23rd in Ho Chi Minh (UTC+7).
    const view = buildToday(
      [session({ id: "late-night", scheduledStartTime: "2026-10-22T23:30:00Z" })],
      new Date("2026-10-22T23:00:00Z"),
      "Asia/Ho_Chi_Minh",
    );
    expect(view.next?.id).toBe("late-night");
  });

  it("returns an empty view for no sessions", () => {
    expect(buildToday([], NOW, TZ)).toEqual({ next: null, later: [] });
  });
});
