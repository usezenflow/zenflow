import { describe, expect, it } from "vitest";
import {
  bufferLabel,
  focusGrid,
  focusReady,
  focusTotal,
  gridMax,
  heatLevel,
  hoursOf,
  insightsWindow,
} from "../insights";

describe("focusGrid", () => {
  it("places counts by weekday and hour and sums repeats", () => {
    const grid = focusGrid([
      { weekday: 0, hour: 9, done: 2 },
      { weekday: 0, hour: 9, done: 1 },
      { weekday: 6, hour: 23, done: 4 },
    ]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid[0][9]).toBe(3);
    expect(grid[6][23]).toBe(4);
    expect(gridMax(grid)).toBe(4);
  });

  it("drops cells outside the 7 by 24 grid", () => {
    const grid = focusGrid([
      { weekday: 7, hour: 0, done: 5 },
      { weekday: 0, hour: 24, done: 5 },
      { weekday: -1, hour: 3, done: 5 },
    ]);
    expect(gridMax(grid)).toBe(0);
  });
});

describe("focus readiness", () => {
  it("needs at least five DONE events", () => {
    expect(focusReady([{ weekday: 1, hour: 8, done: 4 }])).toBe(false);
    expect(focusReady([{ weekday: 1, hour: 8, done: 5 }])).toBe(true);
    expect(focusTotal([])).toBe(0);
  });
});

describe("heatLevel", () => {
  it("is zero for an empty cell or an empty map", () => {
    expect(heatLevel(0, 4)).toBe(0);
    expect(heatLevel(3, 0)).toBe(0);
  });

  it("buckets the busiest cell at the top level", () => {
    expect(heatLevel(4, 4)).toBe(4);
    expect(heatLevel(3, 4)).toBe(3);
    expect(heatLevel(2, 4)).toBe(2);
    expect(heatLevel(1, 4)).toBe(1);
  });

  it("keeps any non-empty cell visible", () => {
    expect(heatLevel(1, 40)).toBe(1);
    expect(heatLevel(40, 40)).toBe(4);
  });
});

describe("bufferLabel", () => {
  it("reads nothing planned when there is no prep", () => {
    expect(bufferLabel(null)).toEqual({ key: "Nothing planned yet" });
  });

  it("reads the whole days of prep", () => {
    expect(bufferLabel(0)).toEqual({ key: "Prep ready, under a day" });
    expect(bufferLabel(1)).toEqual({ key: "Prep ready, 1 day" });
    expect(bufferLabel(3)).toEqual({
      key: "Prep ready, {days} days",
      values: { days: 3 },
    });
  });
});

describe("hoursOf", () => {
  it("rounds minutes to one decimal hour", () => {
    expect(hoursOf(0)).toBe(0);
    expect(hoursOf(90)).toBe(1.5);
    expect(hoursOf(100)).toBe(1.7);
    expect(hoursOf(45)).toBe(0.8);
  });
});

describe("insightsWindow", () => {
  it("spans seven days ending on the wall-clock day", () => {
    expect(insightsWindow(new Date(2026, 9, 23, 0, 30))).toEqual({
      from: "2026-10-17",
      to: "2026-10-23",
    });
  });

  it("crosses month boundaries", () => {
    expect(insightsWindow(new Date(2026, 9, 3, 12), 7)).toEqual({
      from: "2026-09-27",
      to: "2026-10-03",
    });
  });
});
