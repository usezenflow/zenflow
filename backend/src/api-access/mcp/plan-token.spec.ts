import { PlanTokens } from "./plan-token";

describe("PlanTokens", () => {
  const tokens = new PlanTokens("pepper");
  const args = { items: [{ id: "a", kind: "session" }], x: 1 };

  it("accepts the same arguments in any key order", () => {
    const id = tokens.issue("u1", "delete_sessions", args);
    expect(
      tokens.verify("" + id, "u1", "delete_sessions", {
        x: 1,
        items: [{ kind: "session", id: "a" }],
      }),
    ).toBe(true);
  });

  it("rejects changed arguments, another user, another tool", () => {
    const id = tokens.issue("u1", "delete_sessions", args);
    expect(tokens.verify(id, "u1", "delete_sessions", { ...args, x: 2 })).toBe(
      false,
    );
    expect(tokens.verify(id, "u2", "delete_sessions", args)).toBe(false);
    expect(tokens.verify(id, "u1", "create_tasks", args)).toBe(false);
  });

  it("rejects an expired or malformed token", () => {
    const id = tokens.issue("u1", "t", args, 0);
    expect(tokens.verify(id, "u1", "t", args, 11 * 60_000)).toBe(false);
    expect(tokens.verify("junk", "u1", "t", args)).toBe(false);
  });
});
