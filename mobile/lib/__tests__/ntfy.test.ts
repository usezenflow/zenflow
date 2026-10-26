import { describe, expect, it } from "vitest";
import { ntfySubscribeUrl, topicFromBytes } from "../ntfy";

describe("ntfy", () => {
  it("builds a 32+ char hex topic", () => {
    const topic = topicFromBytes(new Uint8Array(16).fill(255));
    expect(topic).toBe(`zf-${"ff".repeat(16)}`);
    expect(topic.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects too few bytes", () => {
    expect(() => topicFromBytes(new Uint8Array(4))).toThrow();
  });

  it("builds the subscribe link from the base url", () => {
    expect(ntfySubscribeUrl("https://ntfy.example.com/", "zf-ab")).toBe(
      "ntfy://subscribe/ntfy.example.com/zf-ab",
    );
  });
});
