import { timeInfo } from "./mcp-time";

describe("timeInfo", () => {
  // 2026-10-26 is a Monday; 18:00 UTC is already Tuesday 01:00 in Ho Chi Minh.
  const now = new Date("2026-10-26T18:00:00Z");

  it("answers in the user's timezone with an offset", () => {
    const t = timeInfo("Asia/Ho_Chi_Minh", now);
    expect(t.now).toBe("2026-10-27T01:00:00+07:00");
    expect(t.today).toEqual({ date: "2026-10-27", weekday: "Tuesday" });
    expect(t.tomorrow).toEqual({ date: "2026-10-28", weekday: "Wednesday" });
  });

  it("gives the Monday to Sunday week and 14 days", () => {
    const t = timeInfo("Asia/Ho_Chi_Minh", now);
    expect(t.week).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(t.next14Days).toHaveLength(14);
    expect(t.next14Days[0].date).toBe("2026-10-27");
  });
});
