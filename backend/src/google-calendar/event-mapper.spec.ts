import {
  eventIdOf,
  payloadHash,
  seriesEvent,
  sessionEvent,
  type EventContext,
  type EventSession,
} from "./event-mapper";

const ctx: EventContext = {
  timezone: "Asia/Ho_Chi_Minh",
  defaultReminderMinutes: 30,
  appUrl: "https://app.usezenflow.com",
};

const session: EventSession = {
  id: "0b6f1f1e-7c1a-4a55-9d2e-3b8c6a1d9e10",
  title: "Write report",
  type: "TASK",
  location: "Room A305",
  durationMinutes: 60,
  deadline: new Date("2026-11-06T16:59:00Z"),
  scheduledStartTime: new Date("2026-11-02T02:00:00Z"),
  reminderMinutes: null,
};

describe("event mapper", () => {
  it("derives a Google-safe event id from a uuid", () => {
    const id = eventIdOf(session.id);
    expect(id).toBe("0b6f1f1e7c1a4a559d2e3b8c6a1d9e10");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it("maps a single session", () => {
    const body = sessionEvent(session, ctx);
    expect(body.summary).toBe("Write report");
    expect(body.location).toBe("Room A305");
    expect(body.start).toEqual({
      dateTime: "2026-11-02T02:00:00.000Z",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    expect(body.end.dateTime).toBe("2026-11-02T03:00:00.000Z");
    expect(body.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });
    expect(body.extendedProperties.private).toEqual({
      zf: session.id,
      zfk: "s",
    });
    expect(body.description).toContain("Due ");
    expect(body.recurrence).toBeUndefined();
  });

  it("rings 30 minutes before, but never for DND", () => {
    expect(sessionEvent(session, ctx).reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });
    expect(sessionEvent({ ...session, type: "DND" }, ctx).reminders).toEqual({
      useDefault: false,
      overrides: [],
    });
  });

  it("uses the session's reminder over the user's default, and 0 for none", () => {
    const popup = (minutes: number) => ({
      useDefault: false,
      overrides: [{ method: "popup", minutes }],
    });
    expect(
      sessionEvent({ ...session, reminderMinutes: 10 }, ctx).reminders,
    ).toEqual(popup(10));
    expect(
      sessionEvent({ ...session, reminderMinutes: 0 }, ctx).reminders,
    ).toEqual({ useDefault: false, overrides: [] });
    expect(
      sessionEvent(session, { ...ctx, defaultReminderMinutes: 60 }).reminders,
    ).toEqual(popup(60));
  });

  it("gives each session type its own colour", () => {
    const types = ["TASK", "ASSIGNMENT", "EXAM", "LECTURE", "DND"] as const;
    const colours = types.map(
      (type) => sessionEvent({ ...session, type }, ctx).colorId,
    );
    expect(new Set(colours).size).toBe(types.length);
  });

  it("omits an empty location", () => {
    expect(
      sessionEvent({ ...session, location: null }, ctx),
    ).not.toHaveProperty("location");
  });

  it("maps a recurring series with its deleted occurrences as EXDATE", () => {
    const body = seriesEvent(
      { ...session, type: "LECTURE" },
      {
        id: "11111111-1111-4111-8111-111111111111",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        exdates: [
          "2026-11-16T02:00:00.000Z",
          "2026-11-09T02:00:00.000Z",
          "2026-11-09T02:00:00.000Z",
        ],
      },
      ctx,
    );
    expect(body.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261109T020000Z,20261116T020000Z",
    ]);
    expect(body.extendedProperties.private.zfk).toBe("r");
  });

  it("omits EXDATE when nothing was deleted", () => {
    const body = seriesEvent(
      session,
      { id: "s", rrule: "FREQ=DAILY", exdates: [] },
      ctx,
    );
    expect(body.recurrence).toEqual(["RRULE:FREQ=DAILY"]);
  });

  it("hashes equal payloads equally and different ones differently", () => {
    const a = payloadHash(sessionEvent(session, ctx));
    expect(payloadHash(sessionEvent(session, ctx))).toBe(a);
    expect(
      payloadHash(sessionEvent({ ...session, title: "Other" }, ctx)),
    ).not.toBe(a);
  });
});
