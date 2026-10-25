import { GoogleApiError, GoogleCalendarClient } from "./google-calendar.client";

const body = { summary: "x" } as never;
const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status });
const error = (status: number, reason: string) =>
  json(status, { error: { message: reason, errors: [{ reason }] } });

describe("GoogleCalendarClient", () => {
  const client = new GoogleCalendarClient();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch");
  });
  afterEach(() => fetchMock.mockRestore());

  it("creates an event with the deterministic id", async () => {
    fetchMock.mockResolvedValue(json(200, { etag: '"e1"' }));

    expect(await client.writeEvent("t", "cal@x", "aaaa1", body, false)).toBe(
      '"e1"',
    );
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/calendar/v3/calendars/cal%40x/events");
    expect(JSON.parse(init.body as string)).toMatchObject({ id: "aaaa1" });
  });

  it("replaces the event when the id already exists", async () => {
    fetchMock
      .mockResolvedValueOnce(error(409, "duplicate"))
      .mockResolvedValueOnce(json(200, { etag: '"e2"' }));

    expect(await client.writeEvent("t", "cal", "aaaa1", body, false)).toBe(
      '"e2"',
    );
    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url.pathname.endsWith("/events/aaaa1")).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      status: "confirmed",
    });
  });

  it("treats an already deleted event as deleted", async () => {
    fetchMock
      .mockResolvedValueOnce(error(410, "deleted"))
      .mockResolvedValueOnce(error(404, "notFound"));
    await expect(
      client.deleteEvent("t", "cal", "aaaa1"),
    ).resolves.toBeUndefined();
    await expect(
      client.deleteEvent("t", "cal", "aaaa1"),
    ).resolves.toBeUndefined();
  });

  it("classifies failures", () => {
    expect(new GoogleApiError(429, "", "").retryable).toBe(true);
    expect(new GoogleApiError(503, "", "").retryable).toBe(true);
    expect(new GoogleApiError(403, "userRateLimitExceeded", "").retryable).toBe(
      true,
    );
    expect(new GoogleApiError(403, "forbidden", "").retryable).toBe(false);
    expect(new GoogleApiError(400, "invalid", "").retryable).toBe(false);
    expect(new GoogleApiError(401, "", "").authRevoked).toBe(true);
    expect(new GoogleApiError(400, "invalid_grant", "").authRevoked).toBe(true);
  });

  it("surfaces the API reason on errors", async () => {
    fetchMock.mockResolvedValue(error(403, "rateLimitExceeded"));
    await expect(client.listEvents("t", "cal", {})).rejects.toMatchObject({
      status: 403,
      reason: "rateLimitExceeded",
    });
  });
});
