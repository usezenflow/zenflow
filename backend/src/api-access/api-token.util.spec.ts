import { hashApiToken } from "./api-token.util";

describe("hashApiToken", () => {
  const pepper = "pepper-one-that-is-long-enough-1234";

  it("is deterministic hex and never contains the secret", () => {
    const hash = hashApiToken("zo_secret", pepper);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashApiToken("zo_secret", pepper));
    expect(hash).not.toContain("zo_secret");
  });

  it("differs by pepper", () => {
    expect(hashApiToken("zo_secret", pepper)).not.toBe(
      hashApiToken("zo_secret", "pepper-two-that-is-long-enough-1234"),
    );
  });
});
