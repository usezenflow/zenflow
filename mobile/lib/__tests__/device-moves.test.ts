import { describe, expect, it } from "vitest";
import type { Session } from "@zenflow/shared";
import { reviewDeviceEvents } from "../device-calendar/moves";
import type { DeviceLinks } from "../device-calendar/plan";

const START = Date.parse("2026-11-02T02:00:00.000Z");
const HOUR = 60 * 60_000;

function task(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    type: "TASK",
    seriesId: null,
    scheduledStartTime: new Date(START).toISOString(),
    durationMinutes: 60,
    ...over,
  } as Session;
}

const links: DeviceLinks = {
  s1: { eventId: "e1", hash: "h", startMs: START, endMs: START + HOUR },
};
const sessions = (s: Session) => new Map([[s.id, s]]);

describe("reviewDeviceEvents", () => {
  it("turns a phone move of a task into a move", () => {
    const moved = START + 2 * HOUR;
    const review = reviewDeviceEvents(
      links,
      { e1: { startMs: moved, endMs: moved + HOUR } },
      sessions(task()),
    );
    expect(review.moves).toEqual([{ key: "s1", startMs: moved, durationMinutes: 60 }]);
    expect(review.restore.size).toBe(0);
  });

  it("snaps the phone time to the 15-minute grid and keeps at least 15 minutes", () => {
    const review = reviewDeviceEvents(
      links,
      { e1: { startMs: START + 7 * 60_000, endMs: START + 10 * 60_000 } },
      sessions(task()),
    );
    expect(review.moves).toEqual([{ key: "s1", startMs: START, durationMinutes: 15 }]);
  });

  it("rewrites an event the phone deleted", () => {
    const review = reviewDeviceEvents(links, { e1: null }, sessions(task()));
    expect(review.moves).toEqual([]);
    expect([...review.restore]).toEqual(["s1"]);
  });

  it("leaves events it could not read alone", () => {
    const review = reviewDeviceEvents(links, {}, sessions(task()));
    expect(review.moves).toEqual([]);
    expect(review.restore.size).toBe(0);
  });

  it("does not move a session Zenflow changed after the last write", () => {
    const moved = START + 2 * HOUR;
    const changed = task({ scheduledStartTime: new Date(START + HOUR).toISOString() });
    const review = reviewDeviceEvents(
      links,
      { e1: { startMs: moved, endMs: moved + HOUR } },
      sessions(changed),
    );
    expect(review.moves).toEqual([]);
    expect([...review.restore]).toEqual(["s1"]);
  });

  it("does not move fixed sessions or series occurrences", () => {
    const moved = START + 2 * HOUR;
    const times = { e1: { startMs: moved, endMs: moved + HOUR } };
    expect(reviewDeviceEvents(links, times, sessions(task({ type: "LECTURE" }))).moves).toEqual([]);
    expect(
      reviewDeviceEvents(links, times, sessions(task({ seriesId: "series-1" }))).moves,
    ).toEqual([]);
  });

  it("restores an edit that changes nothing once rounded", () => {
    const review = reviewDeviceEvents(
      links,
      { e1: { startMs: START, endMs: START + HOUR + 60_000 } },
      sessions(task()),
    );
    expect(review.moves).toEqual([]);
    expect([...review.restore]).toEqual(["s1"]);
  });
});
