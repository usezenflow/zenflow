import { courseKeyOf, placementReasonOf } from "./session-mapper";

const START = new Date("2026-06-11T08:00:00.000Z");
const ALT = new Date("2026-06-11T10:00:00.000Z");

describe("placementReasonOf (#254)", () => {
  it("returns the reason while the start is the one it was made for", () => {
    expect(
      placementReasonOf({
        placementReason: "PREFERRED_HOUR",
        placementReasonStartAt: START,
        scheduledStartTime: START,
      }),
    ).toBe("PREFERRED_HOUR");
  });

  it("hides the reason once the start has moved", () => {
    expect(
      placementReasonOf({
        placementReason: "PREFERRED_HOUR",
        placementReasonStartAt: START,
        scheduledStartTime: ALT,
      }),
    ).toBeNull();
  });

  it("is null without a reason or a start", () => {
    expect(
      placementReasonOf({
        placementReason: null,
        placementReasonStartAt: null,
        scheduledStartTime: START,
      }),
    ).toBeNull();
    expect(
      placementReasonOf({
        placementReason: "NEAR_CLASS",
        placementReasonStartAt: START,
        scheduledStartTime: null,
      }),
    ).toBeNull();
  });
});

describe("courseKeyOf", () => {
  it("keys an LMS item by its Moodle course id", () => {
    expect(courseKeyOf({ lmsCourseId: 90001, scheduleStudyUnitId: null })).toBe(
      "lms:90001",
    );
  });

  it("keys a portal item by its section id", () => {
    expect(
      courseKeyOf({ lmsCourseId: null, scheduleStudyUnitId: "99910AB100101" }),
    ).toBe("portal:99910AB100101");
  });

  it("is null for a user-created session", () => {
    expect(
      courseKeyOf({ lmsCourseId: null, scheduleStudyUnitId: null }),
    ).toBeNull();
  });
});
