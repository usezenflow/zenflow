import {
  addLines,
  checkCommand,
  parseCommand,
  rangePreset,
  type Range,
} from "@/lib/palette/command";
import { describe, expect, it } from "vitest";

const base: {
  text: string;
  targets: number;
  range: Range | null;
  minutes: number | null;
} = { text: "", targets: 0, range: null, minutes: null };
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("parseCommand", () => {
  it("matches the first word exactly, accents folded", () => {
    expect(parseCommand("recap").verb).toBe("recap");
    expect(parseCommand("Tổng kết").verb).toBe("recap");
    expect(parseCommand("xóa").verb).toBe("delete");
    expect(parseCommand("xếp lại").verb).toBe("replan");
  });
  it("leaves titles alone", () => {
    expect(parseCommand("recaps of math").verb).toBe("add");
    expect(parseCommand("review notes").verb).toBe("add");
    expect(parseCommand("math 2h")).toEqual({
      verb: "add",
      rest: "math 2h",
      consumed: 0,
    });
  });
  it("add forces a plain add", () => {
    expect(parseCommand("add view lecture")).toEqual({
      verb: "add",
      rest: "view lecture",
      consumed: 0,
    });
  });
  it("keeps the rest after the verb", () => {
    expect(parseCommand("edit move this to 3pm")).toEqual({
      verb: "edit",
      rest: "move this to 3pm",
      consumed: 4,
    });
  });
});

describe("rangePreset", () => {
  const wed = new Date(2026, 9, 28, 14); // Wed 28 Oct 2026
  it("weeks start Monday", () => {
    const w = rangePreset("this_week", wed);
    expect([w.from.getDate(), w.to.getDate()]).toEqual([26, 1]);
    expect(rangePreset("last_week", wed).from.getDate()).toBe(19);
    expect(rangePreset("next_week", wed).from.getDate()).toBe(2);
  });
  it("months", () => {
    const m = rangePreset("last_month", wed);
    expect([m.from.getMonth(), m.from.getDate(), m.to.getDate()]).toEqual([
      8, 1, 30,
    ]);
  });
  it("today and tomorrow", () => {
    expect(rangePreset("tomorrow", wed).from.getDate()).toBe(29);
    expect(
      day(rangePreset("today", wed).to) <= day(rangePreset("tomorrow", wed).to),
    ).toBe(true);
  });
});

describe("checkCommand", () => {
  const cmd = (text: string) => parseCommand(text);
  const run = (text: string, extra: Partial<typeof base> = {}) =>
    checkCommand({ cmd: cmd(text), ...base, text, ...extra });
  it("asks for what is missing", () => {
    expect(run("recap")).toMatch(/needs a range/);
    expect(run("delete")).toMatch(/needs a task/);
    expect(run("edit")).toMatch(/needs a task/);
    expect(run("free")).toMatch(/duration/);
  });
  it("accepts complete commands", () => {
    const wed = new Date(2026, 9, 28);
    expect(run("recap", { range: rangePreset("last_week", wed) })).toBeNull();
    expect(run("delete", { targets: 2 })).toBeNull();
    expect(
      run("free", { minutes: 120, range: rangePreset("this_week", wed) }),
    ).toBeNull();
  });
  it("rejects a bad range", () => {
    const wed = new Date(2026, 9, 28);
    expect(
      run("recap", { range: { from: wed, to: new Date(2026, 9, 1) } }),
    ).toMatch(/before start/);
    expect(
      run("recap", { range: { from: wed, to: new Date(2028, 9, 1) } }),
    ).toMatch(/over 366/);
  });
  it("limits adds", () => {
    expect(run("a\n".repeat(51))).toMatch(/Over 50/);
    expect(run("x".repeat(61))).toMatch(/60 characters/);
    expect(run("math\n\nphysics")).toBeNull();
    expect(addLines("math\n\n physics ")).toEqual(["math", "physics"]);
    expect(addLines("math 2h, physics; chem 1,5h")).toEqual([
      "math 2h",
      "physics",
      "chem 1,5h",
    ]);
  });
});
