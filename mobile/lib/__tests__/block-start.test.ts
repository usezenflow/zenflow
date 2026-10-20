import { describe, expect, it } from "vitest";
import type { Session } from "@zenflow/shared";

import { isInPlacedBlock } from "../placed-block";

const START = Date.parse("2026-10-20T09:00:00.000Z");
const block = (over: Partial<Session> = {}) =>
  ({
    type: "TASK",
    scheduledStartTime: "2026-10-20T09:00:00.000Z",
    durationMinutes: 60,
    ...over,
  }) as Session;

describe("isInPlacedBlock", () => {
  it("is true from the start up to the end of the slot", () => {
    expect(isInPlacedBlock(block(), START)).toBe(true);
    expect(isInPlacedBlock(block(), START + 59 * 60_000)).toBe(true);
  });

  it("is false at the end and before the start", () => {
    expect(isInPlacedBlock(block(), START + 60 * 60_000)).toBe(false);
    expect(isInPlacedBlock(block(), START - 1)).toBe(false);
  });

  it("is false for anything but a task", () => {
    expect(isInPlacedBlock(block({ type: "LECTURE" }), START)).toBe(false);
  });

  it("is false without a scheduled start", () => {
    expect(isInPlacedBlock(block({ scheduledStartTime: null }), START)).toBe(false);
  });
});
