const API = "/calendar/v3";

interface StoredEvent {
  body: Record<string, unknown>;
  etag: string;
  /** Global change number; sync tokens are the number last seen. */
  seq: number;
  status: "confirmed" | "cancelled";
}

export interface FailureRule {
  method?: string;
  /** Matches the path after `/calendar/v3`. */
  path?: RegExp;
  status: number;
  reason: string;
  times?: number;
}

export interface RecordedCall {
  method: string;
  path: string;
  ifMatch: string | null;
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const error = (status: number, reason: string) =>
  json(status, { error: { message: reason, errors: [{ reason }] } });

/**
 * In-process stand-in for the Google Calendar REST API. Install it with
 * `jest.spyOn(global, "fetch").mockImplementation(fake.fetch)`. It keeps ETags,
 * `If-Match`, sync tokens (expirable), tombstones and paging, so the real
 * client runs against it unchanged. Out-of-band edits (`edit`, `remove`) play
 * the user changing an event in Google.
 */
export class FakeGoogleCalendar {
  readonly calls: RecordedCall[] = [];
  private readonly calendars = new Map<string, Map<string, StoredEvent>>();
  private readonly channels = new Map<string, string>();
  private seq = 0;
  private etags = 0;
  /** Sync tokens at or below this change number have expired (410). */
  private expiredThrough = 0;
  private failures: FailureRule[] = [];

  readonly fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => Promise.resolve(this.handle(input, init));

  private handle(input: string | URL | Request, init?: RequestInit): Response {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(href);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^.*?\/calendar\/v3/, "");
    const ifMatch = new Headers(init?.headers).get("If-Match");
    this.calls.push({ method, path, ifMatch });

    const failure = this.takeFailure(method, path);
    if (failure) return error(failure.status, failure.reason);
    if (!new Headers(init?.headers).get("Authorization"))
      return error(401, "authError");

    const body = init?.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined;
    return this.route(method, path, url, body, ifMatch);
  }

  /** The next `times` matching requests fail with `status` and `reason`. */
  failNext(rule: FailureRule): void {
    this.failures.push({ times: 1, ...rule });
  }

  /** Every sync token issued so far stops working, as Google does after a long gap. */
  expireSyncTokens(): void {
    this.expiredThrough = this.seq;
  }

  /** Events a user can see in a calendar, cancelled ones excluded. */
  liveEvents(calendarId: string): Record<string, unknown>[] {
    return [...(this.calendars.get(calendarId)?.values() ?? [])]
      .filter((e) => e.status === "confirmed")
      .map((e) => this.item(e));
  }

  /** The user edits an event in Google. Fields are merged over the current body. */
  edit(
    calendarId: string,
    eventId: string,
    fields: Record<string, unknown>,
  ): void {
    const event = this.calendars.get(calendarId)?.get(eventId);
    if (!event) throw new Error(`no event ${eventId}`);
    event.body = { ...event.body, ...fields };
    this.bump(event);
  }

  /** The user deletes an event in Google. Leaves a tombstone, as the API does. */
  remove(calendarId: string, eventId: string): void {
    const event = this.calendars.get(calendarId)?.get(eventId);
    if (!event) throw new Error(`no event ${eventId}`);
    event.status = "cancelled";
    this.bump(event);
  }

  /** Puts an event in place without the client, as a user adding one in Google would. */
  insert(calendarId: string, body: Record<string, unknown>): string {
    const id = (body.id as string | undefined) ?? `user${++this.etags}`;
    const events = this.eventsOf(calendarId);
    const event: StoredEvent = {
      body: { ...body, id },
      etag: "",
      seq: 0,
      status: "confirmed",
    };
    events.set(id, event);
    this.bump(event);
    return id;
  }

  private takeFailure(method: string, path: string): FailureRule | undefined {
    const rule = this.failures.find(
      (f) =>
        (!f.method || f.method === method) && (!f.path || f.path.test(path)),
    );
    if (!rule) return undefined;
    rule.times = (rule.times ?? 1) - 1;
    if (rule.times <= 0)
      this.failures = this.failures.filter((f) => f !== rule);
    return rule;
  }

  private route(
    method: string,
    path: string,
    url: URL,
    body: Record<string, unknown> | undefined,
    ifMatch: string | null,
  ): Response {
    const p = path.replace(API, "");
    if (method === "GET" && p === "/users/me/calendarList") {
      return json(200, {
        items: [...this.calendars.keys()].map((id) => ({ id, selected: true })),
      });
    }
    if (method === "POST" && p === "/calendars") {
      const id = `cal${++this.etags}@group.calendar.google.com`;
      this.calendars.set(id, new Map());
      return json(200, { id });
    }
    if (method === "POST" && p === "/channels/stop")
      return new Response(null, { status: 204 });

    const watch = /^\/calendars\/([^/]+)\/events\/watch$/.exec(p);
    if (watch && method === "POST") {
      const id = body?.id as string;
      this.channels.set(id, decodeURIComponent(watch[1]));
      return json(200, {
        resourceId: `res-${id}`,
        expiration: body?.expiration as string,
      });
    }

    const cal = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(p);
    if (!cal) return error(404, "notFound");
    const calendarId = decodeURIComponent(cal[1]);
    const eventId = cal[3] ? decodeURIComponent(cal[3]) : undefined;

    if (!cal[2] && method === "DELETE") {
      if (!this.calendars.delete(calendarId)) return error(404, "notFound");
      return new Response(null, { status: 204 });
    }
    if (!this.calendars.has(calendarId)) return error(404, "notFound");

    if (!eventId && method === "GET") return this.list(calendarId, url);
    if (!eventId && method === "POST") return this.create(calendarId, body!);
    if (eventId && method === "PUT")
      return this.replace(calendarId, eventId, body!, ifMatch);
    if (eventId && method === "DELETE") return this.delete(calendarId, eventId);
    return error(405, "methodNotAllowed");
  }

  private list(calendarId: string, url: URL): Response {
    const events = this.eventsOf(calendarId);
    const syncToken = url.searchParams.get("syncToken");
    if (syncToken !== null) {
      if (Number(syncToken) <= this.expiredThrough)
        return error(410, "fullSyncRequired");
      const changed = [...events.values()].filter(
        (e) => e.seq > Number(syncToken),
      );
      return json(200, {
        items: changed.map((e) => this.item(e)),
        nextSyncToken: String(this.seq),
      });
    }

    const min = url.searchParams.get("timeMin");
    const max = url.searchParams.get("timeMax");
    const all = [...events.values()].filter(
      (e) =>
        e.status === "confirmed" &&
        (!min || startOf(e) >= min) &&
        (!max || startOf(e) < max),
    );
    const size = Number(url.searchParams.get("maxResults") ?? 250);
    const offset = Number(url.searchParams.get("pageToken") ?? 0);
    const page = all.slice(offset, offset + size).map((e) => this.item(e));
    const more = offset + size < all.length;
    return json(200, {
      items: page,
      ...(more ? { nextPageToken: String(offset + size) } : {}),
      nextSyncToken: String(this.seq),
    });
  }

  private create(calendarId: string, body: Record<string, unknown>): Response {
    const id = body.id as string;
    const events = this.eventsOf(calendarId);
    if (events.has(id)) return error(409, "duplicate");
    const event: StoredEvent = {
      body: { ...body, id },
      etag: "",
      seq: 0,
      status: "confirmed",
    };
    events.set(id, event);
    this.bump(event);
    return json(200, this.item(event));
  }

  private replace(
    calendarId: string,
    id: string,
    body: Record<string, unknown>,
    ifMatch: string | null,
  ): Response {
    const event = this.eventsOf(calendarId).get(id);
    if (!event) return error(404, "notFound");
    if (ifMatch && ifMatch !== event.etag) return error(412, "conditionNotMet");
    event.body = { ...body, id };
    event.status = body.status === "cancelled" ? "cancelled" : "confirmed";
    this.bump(event);
    return json(200, this.item(event));
  }

  private delete(calendarId: string, id: string): Response {
    const event = this.eventsOf(calendarId).get(id);
    if (!event) return error(404, "notFound");
    if (event.status === "cancelled") return error(410, "deleted");
    event.status = "cancelled";
    this.bump(event);
    return new Response(null, { status: 204 });
  }

  private eventsOf(calendarId: string): Map<string, StoredEvent> {
    let events = this.calendars.get(calendarId);
    if (!events) {
      events = new Map();
      this.calendars.set(calendarId, events);
    }
    return events;
  }

  private bump(event: StoredEvent): void {
    event.seq = ++this.seq;
    event.etag = `"e${++this.etags}"`;
  }

  private item(event: StoredEvent): Record<string, unknown> {
    return { ...event.body, etag: event.etag, status: event.status };
  }
}

function startOf(event: StoredEvent): string {
  const start = event.body.start as { dateTime?: string } | undefined;
  return start?.dateTime ?? "";
}
