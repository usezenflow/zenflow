import { DELETE_REWARD, MOVE_REWARD_SCALE_MINUTES } from "../constants";
import {
  armDeleteReward,
  deleteReward,
  dragDistanceReward,
  type DeleteSignal,
} from "./reward";

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

describe("deleteReward", () => {
  const delete_: DeleteSignal = {
    byUser: true,
    type: "TASK",
    source: "USER",
    placedByLinUcb: true,
    everMoved: false,
    replaced: false,
    minutesToStart: 180,
    minutesSincePlacement: 60,
  };

  it("penalises a plain delete of an unmoved LinUCB placement", () => {
    expect(deleteReward(delete_)).toBe(DELETE_REWARD);
  });

  it("is zero when the delete says nothing about the slot", () => {
    const zero: Partial<DeleteSignal>[] = [
      { replaced: true },
      { minutesToStart: 59 },
      { minutesToStart: -30 },
      { minutesSincePlacement: 24 * 60 + 1 },
      { byUser: false },
      { type: "LECTURE" },
      { source: "LMS" },
      { placedByLinUcb: false },
      { everMoved: true },
    ];
    for (const over of zero)
      expect(deleteReward({ ...delete_, ...over })).toBe(0);
  });

  it("accepts a delete an hour before start and a day after placement", () => {
    expect(deleteReward({ ...delete_, minutesToStart: 60 })).toBe(
      DELETE_REWARD,
    );
    expect(deleteReward({ ...delete_, minutesSincePlacement: 24 * 60 })).toBe(
      DELETE_REWARD,
    );
  });

  it("keeps the arm at zero in shadow mode", () => {
    expect(armDeleteReward(delete_)).toBe(0);
  });
});
