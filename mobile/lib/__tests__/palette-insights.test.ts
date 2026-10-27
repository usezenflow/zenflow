import { insightText } from "@/lib/palette/insights";
import { placeholderFor } from "@/lib/palette/placeholder";
import { describe, expect, it } from "vitest";

describe("insightText", () => {
  it("maps known sentences and leaves others", () => {
    expect(insightText("2 task(s) have no time yet.")).toContain("2");
    expect(insightText("Something new")).toBe("Something new");
  });
});

describe("placeholderFor", () => {
  const base = { verb: "free" as const, targets: 0, hasAction: false, minutes: null, hasRange: false, hasMode: false, hasSlot: false };
  it("follows the picked chips", () => {
    expect(placeholderFor(base)).not.toBe(placeholderFor({ ...base, minutes: 90 }));
    expect(placeholderFor({ ...base, verb: "recap", hasRange: true })).toBe("");
  });
});
