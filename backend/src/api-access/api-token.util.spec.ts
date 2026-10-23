import {
  API_TOKEN_PREFIX,
  generateApiTokenSecret,
  hashApiToken,
} from "./api-token.util";

describe("api token util", () => {
  it("generates a prefixed 256-bit base64url secret", () => {
    const secret = generateApiTokenSecret();
    expect(secret.startsWith(API_TOKEN_PREFIX)).toBe(true);
    // 32 bytes in base64url is 43 characters.
    expect(secret.slice(API_TOKEN_PREFIX.length)).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });

  it("generates a different secret every time", () => {
    const seen = new Set(Array.from({ length: 50 }, generateApiTokenSecret));
    expect(seen.size).toBe(50);
  });

  it("hashes to a stable hex HMAC keyed by the pepper", () => {
    const secret = "zf_example";
    const hash = hashApiToken(secret, "pepper-one-that-is-long-enough-1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken(secret, "pepper-one-that-is-long-enough-1234")).toBe(
      hash,
    );
  });

  it("produces a different hash under a different pepper", () => {
    const secret = "zf_example";
    expect(
      hashApiToken(secret, "pepper-a-that-is-long-enough-123456"),
    ).not.toBe(hashApiToken(secret, "pepper-b-that-is-long-enough-123456"));
  });

  it("never returns the secret itself", () => {
    const secret = generateApiTokenSecret();
    expect(
      hashApiToken(secret, "pepper-a-that-is-long-enough-123456"),
    ).not.toContain(secret);
  });
});
