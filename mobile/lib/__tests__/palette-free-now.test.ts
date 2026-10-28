import type { FreeSlotsResponse } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { freeAfterNow } from "../palette/free-now";

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).toISOString();
const slot = (a: string, b: string, free: number): FreeSlotsResponse[number] => ({ start: a, end: b, freeMinutes: free });
const now = new Date(2026, 9, 27, 14, 10);

describe("freeAfterNow", () => {
  it("trims a running slot to the next quarter hour", () => {
    const [s] = freeAfterNow([slot(at(9), at(17), 480)], 60, now);
    expect(s.start).toBe(at(14, 15));
    expect(s.freeMinutes).toBe(165);
  });
  it("drops past slots and slots that no longer fit", () => {
    expect(freeAfterNow([slot(at(8), at(12), 240), slot(at(14), at(15), 60)], 60, now)).toEqual([]);
  });
});
