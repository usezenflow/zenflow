import { FakeGoogleCalendar } from "./fake-google-calendar";
import { GoogleApiError, GoogleCalendarClient } from "./google-calendar.client";

const item = (id: string, summary = "Task") => ({
  id,
  summary,
  start: { dateTime: "2026-11-03T02:00:00.000Z", timeZone: "UTC" },
  end: { dateTime: "2026-11-03T03:00:00.000Z", timeZone: "UTC" },
});
const body = (id: string, summary?: string) => item(id, summary) as never;

describe("FakeGoogleCalendar", () => {
  const client = new GoogleCalendarClient();
  let google: FakeGoogleCalendar;
  let cal: string;

  beforeEach(async () => {
    google = new FakeGoogleCalendar();
    jest.spyOn(global, "fetch").mockImplementation(google.fetch);
    cal = await client.createCalendar("t", "Zenflow", "UTC");
  });
  afterEach(() => jest.restoreAllMocks());

  it("replaces an event when the id already exists", async () => {
    const first = await client.writeEvent("t", cal, "aaaa1", body("aaaa1"), {
      exists: false,
      etag: null,
      notify: false,
    });
    const second = await client.writeEvent(
      "t",
      cal,
      "aaaa1",
      body("aaaa1", "Renamed"),
      { exists: false, etag: null, notify: false },
    );

    expect(second).not.toBe(first);
    expect(google.liveEvents(cal)).toEqual([
      expect.objectContaining({
        id: "aaaa1",
        summary: "Renamed",
        etag: second,
      }),
    ]);
  });

  it("treats an event deleted twice as already gone", async () => {
    await client.writeEvent("t", cal, "aaaa1", body("aaaa1"), {
      exists: false,
      etag: null,
      notify: false,
    });
    await client.deleteEvent("t", cal, "aaaa1");
    await expect(
      client.deleteEvent("t", cal, "aaaa1"),
    ).resolves.toBeUndefined();
    expect(google.liveEvents(cal)).toEqual([]);
  });

  it("returns only what changed since a sync token, tombstones included", async () => {
    google.insert(cal, body("aaaa1"));
    const full = await client.listEvents("t", cal, {});
    expect(full.items.map((i) => i.id)).toEqual(["aaaa1"]);

    google.edit(cal, "aaaa1", { summary: "Moved" });
    google.insert(cal, body("bbbb2"));
    const delta = await client.listEvents("t", cal, {
      syncToken: full.nextSyncToken,
    });
    expect(delta.items.map((i) => i.id).sort()).toEqual(["aaaa1", "bbbb2"]);

    google.remove(cal, "aaaa1");
    const gone = await client.listEvents("t", cal, {
      syncToken: delta.nextSyncToken,
    });
    expect(gone.items).toEqual([
      expect.objectContaining({ id: "aaaa1", status: "cancelled" }),
    ]);
  });

  it("answers 410 for an expired sync token", async () => {
    google.insert(cal, body("aaaa1"));
    const { nextSyncToken } = await client.listEvents("t", cal, {});
    google.expireSyncTokens();

    const failure = client.listEvents("t", cal, { syncToken: nextSyncToken });
    await expect(failure).rejects.toMatchObject({ status: 410 });
  });

  it("refuses a write whose If-Match is stale", async () => {
    const etag = await client.writeEvent("t", cal, "aaaa1", body("aaaa1"), {
      exists: false,
      etag: null,
      notify: false,
    });
    google.edit(cal, "aaaa1", { summary: "Edited in Google" });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/aaaa1`,
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer t",
          "If-Match": etag!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body("aaaa1")),
      },
    );
    expect(res.status).toBe(412);
    expect(google.calls.at(-1)).toMatchObject({ method: "PUT", ifMatch: etag });
  });

  it("injects a failure once, then serves normally", async () => {
    google.failNext({
      method: "POST",
      status: 429,
      reason: "rateLimitExceeded",
    });

    const failed = client.writeEvent("t", cal, "aaaa1", body("aaaa1"), {
      exists: false,
      etag: null,
      notify: false,
    });
    const error = await failed.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).retryable).toBe(true);

    await expect(
      client.writeEvent("t", cal, "aaaa1", body("aaaa1"), {
        exists: false,
        etag: null,
        notify: false,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it("pages a window past one page", async () => {
    const start = new Date("2026-11-03T00:00:00.000Z");
    for (let i = 0; i < 251; i++) {
      google.insert(cal, {
        ...item(`ev${i}`),
        start: {
          dateTime: new Date(start.getTime() + i * 60_000).toISOString(),
        },
      });
    }

    const items = await client.listWindow(
      "t",
      cal,
      start,
      new Date(start.getTime() + 24 * 3_600_000),
    );
    expect(items).toHaveLength(251);
  });

  it("lists the calendars it has created", async () => {
    const calendars = await client.listCalendars("t");
    expect(calendars.map((c) => c.id)).toEqual([cal]);
  });
});
