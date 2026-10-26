import { minutesToUtc } from "../../common/utils";
import { constraintBlocks } from "./constraint-blocks";

const TZ = "Asia/Ho_Chi_Minh";
const day = {
  dayStr: "2026-10-27",
  dayStartMs: minutesToUtc("2026-10-27", 0, TZ).getTime(),
  dayEndMs: minutesToUtc("2026-10-28", 0, TZ).getTime(),
};
const H = 3_600_000;

describe("constraintBlocks", () => {
  it("blocks the day up to notBefore", () => {
    const nb = new Date(day.dayStartMs + 9 * H);
    expect(constraintBlocks(day, TZ, { notBefore: nb }, 0)).toEqual([
      { startMs: day.dayStartMs, endMs: nb.getTime() },
    ]);
  });

  it("blocks everything outside the window", () => {
    expect(constraintBlocks(day, TZ, { window: "AFTERNOON" }, 0)).toEqual([
      { startMs: day.dayStartMs, endMs: day.dayStartMs + 12 * H },
      { startMs: day.dayStartMs + 18 * H, endMs: day.dayEndMs },
    ]);
  });

  it("keeps an evening task from running past midnight", () => {
    const blocks = constraintBlocks(day, TZ, { window: "EVENING" }, H);
    expect(blocks).toContainEqual({
      startMs: day.dayEndMs,
      endMs: day.dayEndMs + H,
    });
  });

  it("adds nothing without a constraint", () => {
    expect(constraintBlocks(day, TZ, {}, H)).toEqual([]);
  });
});
