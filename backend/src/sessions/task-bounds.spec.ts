import { assertTaskBounds, constraintOf } from "./task-bounds";

const deadline = new Date("2026-11-02T10:00:00Z");

describe("assertTaskBounds", () => {
  it("accepts a start with room before the deadline", () => {
    expect(() =>
      assertTaskBounds({
        notBefore: new Date("2026-11-02T08:00:00Z"),
        durationMinutes: 60,
        deadline,
      }),
    ).not.toThrow();
  });

  it("rejects a start with no room before the deadline", () => {
    expect(() =>
      assertTaskBounds({
        notBefore: new Date("2026-11-02T09:30:00Z"),
        durationMinutes: 60,
        deadline,
      }),
    ).toThrow("Won't fit");
  });

  it("rejects a task longer than its part of the day", () => {
    expect(() =>
      assertTaskBounds({ window: "EVENING", durationMinutes: 390, deadline }),
    ).toThrow("Too long");
  });
});

describe("constraintOf", () => {
  it("turns strings into dates and absent values into null", () => {
    expect(
      constraintOf({ notBefore: "2026-11-02T08:00:00Z" }).notBefore,
    ).toEqual(new Date("2026-11-02T08:00:00Z"));
    expect(constraintOf({})).toEqual({ notBefore: null, window: null });
  });
});
