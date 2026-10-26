import { openToken, sealToken } from "./token-box";

const KEY = { version: 1, hex: "a".repeat(64) };
const KEYS = new Map([[1, KEY.hex]]);

describe("token box", () => {
  it("round-trips a token", () => {
    const sealed = sealToken("1//refresh-token", KEY);
    expect(sealed).not.toContain("refresh-token");
    expect(openToken(sealed, KEYS)).toBe("1//refresh-token");
  });

  it("uses a fresh IV each time", () => {
    expect(sealToken("x", KEY)).not.toBe(sealToken("x", KEY));
  });

  it("opens under the older key while sealing with the newer one", () => {
    const sealed = sealToken("secret", { version: 2, hex: "b".repeat(64) });
    expect(sealed.startsWith("v2.")).toBe(true);
    expect(() => openToken(sealed, KEYS)).toThrow();
    expect(
      openToken(
        sealed,
        new Map([
          [1, KEY.hex],
          [2, "b".repeat(64)],
        ]),
      ),
    ).toBe("secret");
  });

  it("rejects the wrong key and tampered input", () => {
    const sealed = sealToken("secret", KEY);
    expect(() => openToken(sealed, new Map([[1, "b".repeat(64)]]))).toThrow();
    const parts = sealed.split(".");
    parts[3] = "00" + parts[3].slice(2);
    expect(() => openToken(parts.join("."), KEYS)).toThrow();
    expect(() => openToken("garbage", KEYS)).toThrow();
  });
});
