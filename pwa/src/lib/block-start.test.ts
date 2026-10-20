import { describe, expect, it } from "vitest";
import { isInPlacedBlock } from "./block-start";

const block = {
  type: "TASK" as const,
  scheduledStartTime: "2026-10-21T09:00:00.000Z",
  durationMinutes: 60,
};
const at = (iso: string) => Date.parse(iso);

describe("isInPlacedBlock", () => {
  it("is true from the start up to the end of a placed TASK", () => {
    expect(isInPlacedBlock(block, at("2026-10-21T09:00:00.000Z"))).toBe(true);
    expect(isInPlacedBlock(block, at("2026-10-21T09:59:59.000Z"))).toBe(true);
  });

  it("is false before the start and at the end", () => {
    expect(isInPlacedBlock(block, at("2026-10-21T08:59:59.000Z"))).toBe(false);
    expect(isInPlacedBlock(block, at("2026-10-21T10:00:00.000Z"))).toBe(false);
  });

  it("is false for fixed types and unscheduled tasks", () => {
    expect(isInPlacedBlock({ ...block, type: "LECTURE" }, at("2026-10-21T09:30:00.000Z"))).toBe(false);
    expect(isInPlacedBlock({ ...block, scheduledStartTime: null }, at("2026-10-21T09:30:00.000Z"))).toBe(false);
  });
});
