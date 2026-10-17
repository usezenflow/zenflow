import { MOVE_REWARD_SCALE_MINUTES } from "../constants";
import {
  OUTCOME_GRACE_MS,
  OUTCOME_MISS_CUTOFF_MS,
} from "../../common/constants";
import { completionOutcome, dragDistanceReward } from "./reward";

const MIN = 60_000;
const START = 10_000 * MIN;
const END = START + 60 * MIN;
const SETTLE = END + OUTCOME_GRACE_MS;
const CUTOFF = END + OUTCOME_MISS_CUTOFF_MS;

describe("completionOutcome", () => {
  it("settles a check-off inside the slot as DONE at end + grace", () => {
    expect(
      completionOutcome(START, END, START + 5 * MIN, false, SETTLE, null),
    ).toBe("DONE");
  });

  it("counts a check-off at the exact start", () => {
    expect(completionOutcome(START, END, START, false, SETTLE, null)).toBe(
      "DONE",
    );
  });

  it("is unsettled before end + grace even when completed", () => {
    expect(
      completionOutcome(START, END, START, false, SETTLE - 1, null),
    ).toBeNull();
  });

  it("settles a start inside the slot as STARTED without a check-off", () => {
    expect(
      completionOutcome(START, END, null, false, SETTLE, START + MIN),
    ).toBe("STARTED");
  });

  it("does not count a start at or after the end", () => {
    expect(completionOutcome(START, END, null, false, CUTOFF, END)).toBe(
      "LAPSED",
    );
  });

  it("prefers DONE over STARTED", () => {
    expect(
      completionOutcome(START, END, START + MIN, false, SETTLE, START + MIN),
    ).toBe("DONE");
  });

  it("settles a check-off before the start as WRONG_TIME at the cutoff", () => {
    const early = START - MIN;
    expect(
      completionOutcome(START, END, early, false, SETTLE, null),
    ).toBeNull();
    expect(completionOutcome(START, END, early, false, CUTOFF, null)).toBe(
      "WRONG_TIME",
    );
  });

  it("settles a skip as SKIPPED at end + grace, even with a completion stamp", () => {
    expect(completionOutcome(START, END, START + MIN, true, SETTLE, null)).toBe(
      "SKIPPED",
    );
    expect(completionOutcome(START, END, null, true, SETTLE, null)).toBe(
      "SKIPPED",
    );
  });

  it("is unsettled before end + grace for a skip", () => {
    expect(completionOutcome(START, END, null, true, END, null)).toBeNull();
  });

  it("stays unsettled without a start or check-off until the cutoff", () => {
    expect(completionOutcome(START, END, null, false, SETTLE, null)).toBeNull();
    expect(
      completionOutcome(START, END, null, false, CUTOFF - 1, null),
    ).toBeNull();
  });

  it("settles a placement with no start or check-off as LAPSED at the cutoff", () => {
    expect(completionOutcome(START, END, null, false, CUTOFF, null)).toBe(
      "LAPSED",
    );
  });
});

describe("dragDistanceReward", () => {
  it("returns 0 for a zero-distance move", () => {
    expect(dragDistanceReward(0)).toBe(0);
  });

  it("grades a mid-range displacement linearly", () => {
    expect(dragDistanceReward(120)).toBe(-0.5);
  });

  it("is symmetric around zero displacement", () => {
    expect(dragDistanceReward(-120)).toBe(-0.5);
  });

  it("saturates at -1 once the scale is reached", () => {
    expect(dragDistanceReward(MOVE_REWARD_SCALE_MINUTES)).toBe(-1);
    expect(dragDistanceReward(MOVE_REWARD_SCALE_MINUTES * 4)).toBe(-1);
  });
});
