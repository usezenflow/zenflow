import { MAX_SPLIT_CHUNKS, MAX_TASK_MINUTES } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { chunkMinutes, splitLong } from "../palette/split-long";

const now = new Date(2026, 9, 27, 10, 0);
const day = (n: number, h = 23, m = 45) => new Date(2026, 9, 27 + n, h, m);

describe("chunkMinutes", () => {
  it.each([
    [MAX_TASK_MINUTES + 15, [120, 135]],
    [300, [120, 180]],
    [540, [180, 180, 180]],
    [600, [180, 180, 240]],
    [720, [240, 240, 240]],
    [735, [180, 180, 180, 195]],
    [1500, [240, 240, 240, 240, 240, 300]],
  ])("%d minutes", (total, want) => {
    const got = chunkMinutes(total);
    expect(got.length).toBe(Math.ceil(total / MAX_TASK_MINUTES));
    expect(got.reduce((a, b) => a + b, 0)).toBe(total);
    if (total <= 735) expect(got).toEqual(want);
  });
  it("whole hours split in hours, others in 15 minute steps", () => {
    for (const m of chunkMinutes(600)) expect(m % 60).toBe(0);
    for (const m of chunkMinutes(615)) expect(m % 15).toBe(0);
  });
  it("puts the remainder on the later chunks", () => {
    const got = chunkMinutes(600);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });
});

describe("splitLong", () => {
  const task = (minutes: number, deadline: Date, notBefore?: Date) => ({ title: "Toán", durationMinutes: minutes, deadline, notBefore });
  it("does not split a task at or below the cap", () => {
    expect(splitLong(task(MAX_TASK_MINUTES, day(5)), now)).toBeNull();
    expect(splitLong(task(60, day(5)), now)).toBeNull();
  });
  it("splits just over the cap into two", () => {
    expect(splitLong(task(MAX_TASK_MINUTES + 15, day(4)), now)).toHaveLength(2);
  });
  it("does not split beyond the chunk limit", () => {
    expect(splitLong(task(MAX_TASK_MINUTES * MAX_SPLIT_CHUNKS, day(9)), now)).toHaveLength(MAX_SPLIT_CHUNKS);
    expect(splitLong(task(MAX_TASK_MINUTES * MAX_SPLIT_CHUNKS + 15, day(9)), now)).toBeNull();
  });
  it("numbers titles and ends on the real deadline", () => {
    const deadline = day(6);
    const chunks = splitLong(task(600, deadline), now)!;
    expect(chunks.map((c) => c.title)).toEqual(["Toán 1/3", "Toán 2/3", "Toán 3/3"]);
    expect(chunks[2].deadline).toEqual(deadline);
    expect(chunks[0].notBefore).toEqual(now);
  });
  it("sub-windows are contiguous and in order", () => {
    const chunks = splitLong(task(600, day(6)), now)!;
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].notBefore.getTime()).toBe(chunks[i - 1].deadline.getTime());
    }
  });
  it("starts from the user's notBefore when given", () => {
    const nb = day(2, 8, 0);
    const chunks = splitLong(task(600, day(8), nb), now)!;
    expect(chunks[0].notBefore).toEqual(nb);
  });
  it("is null when a chunk does not fit its sub-window", () => {
    expect(splitLong(task(600, new Date(now.getTime() + 60 * 60_000)), now)).toBeNull();
  });
  it("accepts a sub-window exactly as long as its chunk", () => {
    const exact = splitLong(task(540, new Date(now.getTime() + 540 * 60_000)), now);
    expect(exact).toHaveLength(3);
    expect(splitLong(task(540, new Date(now.getTime() + 539 * 60_000)), now)).toBeNull();
  });
  it("is null when the deadline is before the start", () => {
    expect(splitLong(task(600, day(-1)), now)).toBeNull();
  });
});
