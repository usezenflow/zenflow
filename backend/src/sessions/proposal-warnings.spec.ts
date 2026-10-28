import { proposalWarnings } from "./proposal-warnings";

const TZ = "Asia/Ho_Chi_Minh";

describe("proposalWarnings", () => {
  it("flags a weekend start", () => {
    const r = proposalWarnings({
      start: new Date("2026-10-31T01:00:00Z"), // Sat 08:00 local
      durationMinutes: 60,
      timezone: TZ,
    });
    expect(r.localStart).toBe("Saturday 2026-10-31 08:00");
    expect(r.warnings).toEqual(["Falls on a weekend."]);
  });

  it("flags an odd hour, a near deadline and an overlap", () => {
    const r = proposalWarnings({
      start: new Date("2026-10-27T16:00:00Z"), // Tue 23:00 local
      durationMinutes: 60,
      deadline: new Date("2026-10-27T17:30:00Z"),
      timezone: TZ,
      overlaps: true,
    });
    expect(r.warnings).toEqual([
      "Starts outside 07:00 to 22:00.",
      "Ends within an hour of the deadline.",
      "Overlaps another session.",
    ]);
  });
});
