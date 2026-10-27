import { describe, expect, it } from "vitest";
import { Trie } from "../palette/trie";

const build = (words: [string, number][]) => {
  const t = new Trie();
  for (const [w, n] of words) t.insert(w, n);
  return t;
};

describe("Trie", () => {
  it("finds longer words by prefix, heaviest first", () => {
    const t = build([["Toán rời rạc", 1], ["Toán cao cấp", 3], ["Tiếng Anh", 2]]);
    expect(t.complete("to", 5)).toEqual(["Toán cao cấp", "Toán rời rạc"]);
    expect(t.complete("t", 5)).toEqual(["Toán cao cấp", "Tiếng Anh", "Toán rời rạc"]);
  });
  it("matches without accents or case", () => {
    const t = build([["Đồ án", 1], ["Toán", 1]]);
    expect(t.complete("do", 5)).toEqual(["Đồ án"]);
    expect(t.complete("TOA", 5)).toEqual(["Toán"]);
    expect(t.complete("Đ", 5)).toEqual(["Đồ án"]);
  });
  it("excludes the word equal to the prefix", () => {
    const t = build([["toán", 1], ["toán cao cấp", 1]]);
    expect(t.complete("toán", 5)).toEqual(["toán cao cấp"]);
  });
  it("returns nothing for an empty, blank or unknown prefix", () => {
    const t = build([["toán", 1]]);
    expect(t.complete("", 5)).toEqual([]);
    expect(t.complete("   ", 5)).toEqual([]);
    expect(t.complete("xyz", 5)).toEqual([]);
    expect(t.complete("toánn", 5)).toEqual([]);
  });
  it("honours the limit, including zero and negative", () => {
    const t = build([["ab", 1], ["abc", 2], ["abd", 3]]);
    expect(t.complete("a", 2)).toEqual(["abd", "abc"]);
    expect(t.complete("a", 0)).toEqual([]);
    expect(t.complete("a", -1)).toEqual([]);
  });
  it("breaks weight ties by text", () => {
    const t = build([["ac", 1], ["ab", 1]]);
    expect(t.complete("a", 5)).toEqual(["ab", "ac"]);
  });
  it("keeps the heaviest weight when a word is inserted twice", () => {
    const t = build([["ab", 1], ["abc", 2], ["ab", 5]]);
    expect(t.complete("a", 5)).toEqual(["ab", "abc"]);
    const lower = build([["ab", 5], ["abc", 2], ["ab", 1]]);
    expect(lower.complete("a", 5)).toEqual(["ab", "abc"]);
  });
  it("ignores blank words and an empty trie", () => {
    const t = build([["", 9], ["   ", 9]]);
    expect(t.complete("a", 5)).toEqual([]);
  });
  it("trims stored words when matching but returns the original text", () => {
    const t = build([["  Toán  ", 1], ["Toán cao cấp", 1]]);
    expect(t.complete("to", 5)).toContain("  Toán  ");
  });
  it("handles an emoji in a word", () => {
    const t = build([["🔥 toán", 1]]);
    expect(t.complete("🔥", 5)).toEqual(["🔥 toán"]);
  });
});
