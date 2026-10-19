import { prepTargetOf } from "./prep-target";

const NOW = new Date("2026-10-17T02:00:00Z");
const LATER = new Date("2026-10-24T02:00:00Z");

describe("prepTargetOf", () => {
  it("targets a future exam at its start", () => {
    expect(
      prepTargetOf({ type: "EXAM", scheduledStartTime: LATER }, NOW),
    ).toEqual({ kind: "EXAM", deadline: LATER });
  });

  it("targets a future assignment at its due time", () => {
    expect(
      prepTargetOf({ type: "ASSIGNMENT", scheduledStartTime: LATER }, NOW),
    ).toEqual({ kind: "ASSIGNMENT", deadline: LATER });
  });

  it("never targets a lecture", () => {
    expect(
      prepTargetOf({ type: "LECTURE", scheduledStartTime: LATER }, NOW),
    ).toBeNull();
  });

  it("skips an assignment already submitted on the LMS", () => {
    expect(
      prepTargetOf(
        { type: "ASSIGNMENT", scheduledStartTime: LATER },
        NOW,
        true,
      ),
    ).toBeNull();
  });

  it("skips an item whose deadline has passed", () => {
    const past = new Date("2026-10-16T00:00:00Z");
    expect(
      prepTargetOf({ type: "EXAM", scheduledStartTime: past }, NOW),
    ).toBeNull();
  });

  it("skips an item starting exactly now", () => {
    expect(
      prepTargetOf({ type: "EXAM", scheduledStartTime: NOW }, NOW),
    ).toBeNull();
  });
});
