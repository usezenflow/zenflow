import type { Session } from "@zenflow/shared";
import { buildRecap, findFreeSlots } from "./session-recap";

const TZ = "Asia/Ho_Chi_Minh";
const at = (hour: number, date = "2026-10-26") =>
  new Date(
    `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`,
  ).toISOString();
const session = (type: string, hour: number, minutes: number, date?: string) =>
  ({
    id: `${type}${hour}`,
    title: type,
    type,
    durationMinutes: minutes,
    scheduledStartTime: at(hour, date),
    deadline: null,
  }) as unknown as Session;

describe("buildRecap", () => {
  const lecture = session("LECTURE", 9, 180);
  const lunch = session("DND", 11, 120);
  const task = {
    ...session("TASK", 14, 60),
    deadline: at(18),
  } as Session;

  it("sums minutes, finds free blocks and fills the heatmap", () => {
    const r = buildRecap(
      [lecture, lunch, task],
      "2026-10-26",
      "2026-10-26",
      TZ,
    );
    const [d] = r.days;
    expect(d.minutesByType).toEqual({ LECTURE: 180, DND: 120, TASK: 60 });
    expect(d.busyMinutes).toBe(300);
    expect(d.freeMinutes).toBe(900 - 300);
    expect(d.firstStart).toBe("09:00");
    expect(r.hourHeat[0][9]).toBe(60);
    expect(r.deadlines[0].slackMinutes).toBe(180);
  });

  it("flags a day with no lunch break and no overnight block", () => {
    const r = buildRecap([lunch], "2026-10-26", "2026-10-26", TZ);
    expect(r.gaps.daysWithoutLunchBreak).toEqual(["2026-10-26"]);
    expect(r.gaps.hasOvernightDnd).toBe(false);
  });

  it("omits rhythm until habits are learned", () => {
    expect(
      buildRecap([], "2026-10-26", "2026-10-26", TZ).rhythm,
    ).toBeUndefined();
    const matrix = new Array(168)
      .fill(0)
      .map((_, i) => (i % 24 === 20 ? 1 : 0));
    expect(
      buildRecap([], "2026-10-26", "2026-10-26", TZ, matrix).rhythm
        ?.bestStartHours,
    ).toContain(20);
  });
});

describe("findFreeSlots", () => {
  it("returns gaps long enough, inside 07:00 to 22:00", () => {
    const slots = findFreeSlots(
      [session("LECTURE", 9, 180)],
      "2026-10-26",
      "2026-10-26",
      120,
      TZ,
    );
    expect(slots.map((s) => s.start.slice(11, 16))).toEqual(["07:00", "12:00"]);
    expect(slots[1].freeMinutes).toBe(600);
  });
});
