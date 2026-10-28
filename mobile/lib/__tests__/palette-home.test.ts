import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { homeSuggestions, MAX_AGAIN } from "../palette/home";
import { understand } from "../palette/understand";

const now = new Date(2026, 9, 27, 10, 0);
const sess = (
  id: string,
  title: string,
  daysAgo: number,
  over: Partial<Session> = {},
) =>
  ({
    id,
    title,
    type: "TASK",
    durationMinutes: 90,
    scheduledStartTime: new Date(2026, 9, 27 - daysAgo, 14, 0).toISOString(),
    ...over,
  }) as Session;
const again = (cards: { id: string }[]) =>
  cards.filter((c) => c.id.startsWith("again")).map((c) => c.id);

describe("homeSuggestions", () => {
  it("falls back to starters with no data", () => {
    const cards = homeSuggestions({ now });
    expect(cards).toHaveLength(8);
    expect(cards.every((c) => c.id.startsWith("starter"))).toBe(true);
  });
  it("starters are read by the field", () => {
    for (const c of homeSuggestions({ now }).filter((x) => !x.verb))
      expect(understand(c.text, now).spans.length).toBeGreaterThan(0);
    const kinds = homeSuggestions({ now })
      .filter((x) => !x.verb)
      .flatMap((c) => understand(c.text, now).spans.map((x) => x.kind));
    for (const k of ["place", "from", "part", "clock", "length", "day"])
      expect(kinds).toContain(k);
  });
  it("repeats last week's tasks from this weekday, once each, up to the cap, before starters", () => {
    const last = [
      sess("a", "Toán", 7),
      sess("b", "toán", 7),
      sess("c", "Lý", 7),
      sess("d", "Hóa", 7),
      sess("e", "Văn", 7),
      sess("f", "Sử", 6),
    ];
    const cards = homeSuggestions({ now, lastWeek: last });
    expect(again(cards)).toEqual(["again:a", "again:c", "again:d"]);
    expect(again(cards)).toHaveLength(MAX_AGAIN);
    expect(cards[0].text).toBe("Toán");
    expect(cards).toHaveLength(8);
  });
  it("mixes commands in with the examples", () => {
    expect(homeSuggestions({ now }).flatMap((c) => c.verb ?? [])).toEqual([
      "replan",
      "recap",
      "free",
    ]);
  });
  it("skips fixed sessions, unscheduled ones, blank titles and titles already today", () => {
    const last = [
      sess("a", "Lớp", 7, { type: "LECTURE" }),
      sess("b", "Chưa xếp", 7, { scheduledStartTime: null }),
      sess("c", "   ", 7),
      sess("d", "Toán", 7),
    ];
    const today = [sess("t", " TOÁN ", 0)];
    expect(again(homeSuggestions({ now, lastWeek: last, today }))).toEqual([]);
    expect(again(homeSuggestions({ now, lastWeek: last }))).toEqual([
      "again:d",
    ]);
  });
});
