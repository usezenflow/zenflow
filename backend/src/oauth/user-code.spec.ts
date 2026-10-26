import { newUserCode, normalizeUserCode, showUserCode } from "./user-code";

describe("user code", () => {
  it("makes codes that read back the same", () => {
    const code = newUserCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(normalizeUserCode(showUserCode(code))).toBe(code);
  });

  it("accepts lower case, spaces and dashes", () => {
    expect(normalizeUserCode(" abcd-2345 ")).toBe("ABCD2345");
  });

  it("refuses anything else", () => {
    expect(normalizeUserCode("ABCD234")).toBeNull();
    expect(normalizeUserCode("ABCD23450")).toBeNull();
    expect(normalizeUserCode("ABCDO123")).toBeNull();
    expect(normalizeUserCode("")).toBeNull();
  });
});
