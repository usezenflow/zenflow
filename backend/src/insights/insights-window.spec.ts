import { BadRequestException } from "@nestjs/common";
import {
  MAX_WINDOW_DAYS,
  isCalendarDate,
  resolveWindow,
} from "./insights-window";

// 2026-10-23 03:00 UTC is 2026-10-23 10:00 in Asia/Saigon (UTC+7).
const NOW = new Date("2026-10-23T03:00:00.000Z");
const TZ = "Asia/Saigon";

describe("resolveWindow", () => {
  it("defaults to the seven days ending on the user's local today", () => {
    expect(resolveWindow({}, TZ, NOW)).toEqual({
      from: "2026-10-17",
      to: "2026-10-23",
    });
  });

  it("uses the user's local date, not UTC, for today", () => {
    // 2026-10-22 18:00 UTC is already 2026-10-23 01:00 in Saigon.
    const lateUtc = new Date("2026-10-22T18:00:00.000Z");
    expect(resolveWindow({}, TZ, lateUtc).to).toBe("2026-10-23");
    expect(resolveWindow({}, "UTC", lateUtc).to).toBe("2026-10-22");
  });

  it("defaults from to six days before a given to", () => {
    expect(resolveWindow({ to: "2026-09-30" }, TZ, NOW)).toEqual({
      from: "2026-09-24",
      to: "2026-09-30",
    });
  });

  it("defaults to to today when only from is given", () => {
    expect(resolveWindow({ from: "2026-10-01" }, TZ, NOW)).toEqual({
      from: "2026-10-01",
      to: "2026-10-23",
    });
  });

  it("accepts a window of exactly the maximum inclusive days", () => {
    const from = "2026-07-01";
    const to = "2026-09-30";
    expect(resolveWindow({ from, to }, TZ, NOW)).toEqual({ from, to });
  });

  it("rejects a window one day over the maximum", () => {
    expect(() =>
      resolveWindow({ from: "2026-06-30", to: "2026-09-30" }, TZ, NOW),
    ).toThrow(BadRequestException);
    expect(MAX_WINDOW_DAYS).toBe(92);
  });

  it("rejects from after to", () => {
    expect(() =>
      resolveWindow({ from: "2026-10-02", to: "2026-10-01" }, TZ, NOW),
    ).toThrow(BadRequestException);
  });

  it("rejects a date that does not exist", () => {
    expect(() =>
      resolveWindow({ from: "2026-02-30", to: "2026-03-01" }, TZ, NOW),
    ).toThrow(BadRequestException);
  });
});

describe("isCalendarDate", () => {
  it.each([
    ["2026-10-23", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-10-23T00:00:00Z", false],
    ["23-10-2026", false],
  ])("%s -> %s", (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });
});
