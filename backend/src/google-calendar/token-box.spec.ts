import { openToken, sealToken } from "./token-box";

const KEY = "a".repeat(64);

describe("token box", () => {
  it("round-trips a token", () => {
    const sealed = sealToken("1//refresh-token", KEY);
    expect(sealed).not.toContain("refresh-token");
    expect(openToken(sealed, KEY)).toBe("1//refresh-token");
  });

  it("uses a fresh IV each time", () => {
    expect(sealToken("x", KEY)).not.toBe(sealToken("x", KEY));
  });

  it("rejects the wrong key and tampered input", () => {
    const sealed = sealToken("secret", KEY);
    expect(() => openToken(sealed, "b".repeat(64))).toThrow();
    const parts = sealed.split(".");
    parts[3] = "00" + parts[3].slice(2);
    expect(() => openToken(parts.join("."), KEY)).toThrow();
    expect(() => openToken("garbage", KEY)).toThrow();
  });
});
