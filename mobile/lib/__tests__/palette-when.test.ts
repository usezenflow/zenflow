import { describe, expect, it } from "vitest";
import { compose, earliestOn, monthGrid } from "../palette/when";

const now = new Date(2026, 9, 27, 10, 7); // Tue 27/10 10:07

describe("when", () => {
  it("pads Monday first and disables past days", () => {
    const g = monthGrid(new Date(2026, 9, 1), now); // Oct 1 is a Thursday
    expect(g.slice(0, 3).every((c) => c.date === null)).toBe(true);
    expect(g[3].date?.getDate()).toBe(1);
    expect(g.find((c) => c.date?.getDate() === 26)?.disabled).toBe(true);
    expect(g.find((c) => c.date?.getDate() === 27)?.disabled).toBe(false);
  });
  it("clamps today's time to the next step", () => {
    expect(earliestOn(new Date(2026, 9, 27), now)).toBe(10 * 60 + 15);
    expect(earliestOn(new Date(2026, 9, 28), now)).toBe(0);
    expect(compose(new Date(2026, 9, 27), 8 * 60, now).getHours()).toBe(10);
    expect(compose(new Date(2026, 9, 28), 8 * 60, now).getHours()).toBe(8);
  });
});
