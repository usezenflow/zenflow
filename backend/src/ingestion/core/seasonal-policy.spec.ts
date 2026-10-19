import { resolveSemester } from "./semester";
import {
  DEFAULT_OVERRIDES,
  examsCoverEnrolment,
  examWindowOpen,
  examWindowStart,
  marksEligible,
  timetableNextDue,
} from "./seasonal-policy";

const TZ = "Asia/Ho_Chi_Minh";
const at = (iso: string) => new Date(iso);
const termAt = (iso: string) => resolveSemester(at(iso), TZ, 0);

describe("examWindowStart", () => {
  it("opens on the 1st of October, March and June, at midnight in the DLU timezone", () => {
    expect(examWindowStart(termAt("2026-10-15T00:00:00Z"), TZ)).toEqual(
      at("2026-09-30T17:00:00Z"),
    );
    expect(examWindowStart(termAt("2027-03-10T00:00:00Z"), TZ)).toEqual(
      at("2027-02-28T17:00:00Z"),
    );
    expect(examWindowStart(termAt("2027-06-10T00:00:00Z"), TZ)).toEqual(
      at("2027-05-31T17:00:00Z"),
    );
  });
});

describe("examWindowOpen", () => {
  const term = termAt("2026-10-15T00:00:00Z");

  it("is closed before the start month and open from it to the end of the term", () => {
    expect(examWindowOpen(at("2026-09-15T00:00:00Z"), term, TZ)).toBe(false);
    expect(examWindowOpen(at("2026-10-02T00:00:00Z"), term, TZ)).toBe(true);
    expect(examWindowOpen(at("2026-12-20T00:00:00Z"), term, TZ)).toBe(true);
  });

  it("follows the override when one is set", () => {
    const open = { ...DEFAULT_OVERRIDES, examWindow: "open" as const };
    const closed = { ...DEFAULT_OVERRIDES, examWindow: "closed" as const };
    expect(examWindowOpen(at("2026-09-15T00:00:00Z"), term, TZ, open)).toBe(
      true,
    );
    expect(examWindowOpen(at("2026-10-15T00:00:00Z"), term, TZ, closed)).toBe(
      false,
    );
  });
});

describe("examsCoverEnrolment", () => {
  it("is true only when every enrolled section has an exam", () => {
    expect(examsCoverEnrolment(["a", "b"], new Set(["a", "b", "c"]))).toBe(
      true,
    );
    expect(examsCoverEnrolment(["a", "b"], new Set(["a"]))).toBe(false);
  });

  it("is false with no enrolment, so an undiscovered student keeps fetching", () => {
    expect(examsCoverEnrolment([], new Set(["a"]))).toBe(false);
  });
});

describe("timetableNextDue", () => {
  const now = at("2026-10-14T05:00:00Z"); // Wednesday
  const base = { now, tz: TZ, rollingMs: 3 * 60 * 60_000 };

  it("rolls every period while discovery covers fewer than 95% of students", () => {
    expect(timetableNextDue({ ...base, discoveredShare: 0.94 })).toEqual(
      new Date(now.getTime() + 3 * 60 * 60_000),
    );
  });

  it("drops to the start of the next ISO week once 95% are covered", () => {
    expect(timetableNextDue({ ...base, discoveredShare: 0.95 })).toEqual(
      at("2026-10-18T17:00:00Z"), // Monday 19 Oct 00:00 in Ho Chi Minh
    );
  });

  it("uses the weekly override when one is set", () => {
    const overrides = { ...DEFAULT_OVERRIDES, timetableWeeklyMs: 20_000 };
    expect(
      timetableNextDue({ ...base, discoveredShare: 1, overrides }),
    ).toEqual(new Date(now.getTime() + 20_000));
  });
});

describe("marksEligible", () => {
  const firstExamEndsAt = at("2026-10-20T00:00:00Z");

  it("waits one week after the first exam ends", () => {
    expect(
      marksEligible({ now: at("2026-10-26T23:59:00Z"), firstExamEndsAt }),
    ).toBe(false);
    expect(
      marksEligible({ now: at("2026-10-27T00:00:00Z"), firstExamEndsAt }),
    ).toBe(true);
  });

  it("is not due for a student with no exam", () => {
    expect(
      marksEligible({ now: at("2027-01-01T00:00:00Z"), firstExamEndsAt: null }),
    ).toBe(false);
  });

  it("honours the wait override", () => {
    const overrides = { ...DEFAULT_OVERRIDES, marksAfterExamsMs: 0 };
    expect(
      marksEligible({ now: firstExamEndsAt, firstExamEndsAt, overrides }),
    ).toBe(true);
  });
});
