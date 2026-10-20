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
  it("settles a start inside the slot as STARTED at end + grace", () => {
    expect(completionOutcome(START, END, START + 5 * MIN, SETTLE)).toBe(
      "STARTED",
    );
  });

  it("counts a start at the exact start", () => {
    expect(completionOutcome(START, END, START, SETTLE)).toBe("STARTED");
  });

  it("does not count a start at the end", () => {
    expect(completionOutcome(START, END, END, CUTOFF)).toBe("LAPSED");
  });

  it("does not count a start before the slot", () => {
    expect(completionOutcome(START, END, START - MIN, CUTOFF)).toBe("LAPSED");
  });

  it("stays unsettled before grace even with a start", () => {
    expect(completionOutcome(START, END, START, SETTLE - 1)).toBeNull();
  });

  it("stays unsettled without a start until the cutoff", () => {
    expect(completionOutcome(START, END, null, SETTLE)).toBeNull();
    expect(completionOutcome(START, END, null, CUTOFF - 1)).toBeNull();
  });

  it("settles a placement with no start as LAPSED at the cutoff", () => {
    expect(completionOutcome(START, END, null, CUTOFF)).toBe("LAPSED");
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
