import { Injectable } from "@nestjs/common";
import type { GoogleEventBody } from "./event-mapper";

const API = "https://www.googleapis.com/calendar/v3";

/** A Google API failure with enough detail to choose retry, give up or reconnect. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }

  /** Worth retrying later: rate limits and server errors. */
  get retryable(): boolean {
    return (
      this.status === 429 ||
      this.status >= 500 ||
      (this.status === 403 && /rateLimit|quota/i.test(this.reason))
    );
  }

  /** The refresh token no longer works: the user must connect again. */
  get authRevoked(): boolean {
    return this.reason === "invalid_grant" || this.status === 401;
  }
}

export interface GoogleEventItem {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  recurringEventId?: string;
  reminders?: {
    useDefault?: boolean;
    overrides?: { method?: string; minutes?: number }[];
  };
  summary?: string;
  transparency?: "opaque" | "transparent";
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarListItem {
  id: string;
  selected?: boolean;
}

export interface EventPage {
  items: GoogleEventItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface WatchChannel {
  id: string;
  token: string;
  address: string;
  expirationMs: number;
}

@Injectable()
export class GoogleCalendarClient {
  private async call<T>(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
  ): Promise<T | null> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const err = json.error as
        | { message?: string; errors?: { reason?: string }[] }
        | undefined;
      throw new GoogleApiError(
        res.status,
        err?.errors?.[0]?.reason ?? "",
        err?.message ?? `Google Calendar ${res.status}`,
      );
    }
    return json as T;
  }

  async createCalendar(
    token: string,
    summary: string,
    timeZone: string,
  ): Promise<string> {
    const res = await this.call<{ id: string }>(token, "POST", "/calendars", {
      summary,
      timeZone,
    });
    return res!.id;
  }

  async deleteCalendar(token: string, calendarId: string): Promise<void> {
    await this.ignoreGone(() =>
      this.call(
        token,
        "DELETE",
        `/calendars/${encodeURIComponent(calendarId)}`,
      ),
    );
  }

  /** Creates the event, or replaces it when it exists (or was deleted earlier). Returns the etag. */
  async writeEvent(
    token: string,
    calendarId: string,
    eventId: string,
    body: GoogleEventBody,
    exists: boolean,
  ): Promise<string | undefined> {
    const cal = encodeURIComponent(calendarId);
    const put = () =>
      this.call<{ etag: string }>(
        token,
        "PUT",
        `/calendars/${cal}/events/${eventId}`,
        {
          ...body,
          id: eventId,
          status: "confirmed",
        },
      );
    if (exists) return (await put())?.etag;
    try {
      const res = await this.call<{ etag: string }>(
        token,
        "POST",
        `/calendars/${cal}/events`,
        {
          ...body,
          id: eventId,
        },
      );
      return res?.etag;
    } catch (error) {
      // 409: the id exists already, including a deleted event. Replace it.
      if (error instanceof GoogleApiError && error.status === 409)
        return (await put())?.etag;
      throw error;
    }
  }

  async deleteEvent(
    token: string,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    await this.ignoreGone(() =>
      this.call(
        token,
        "DELETE",
        `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      ),
    );
  }

  /** One page of changes; pass `syncToken` for deltas. A 410 means the token expired. */
  async listEvents(
    token: string,
    calendarId: string,
    opts: { syncToken?: string; pageToken?: string },
  ): Promise<EventPage> {
    const res = await this.call<EventPage>(
      token,
      "GET",
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      undefined,
      {
        syncToken: opts.syncToken,
        pageToken: opts.pageToken,
        showDeleted: "true",
        maxResults: "250",
      },
    );
    return {
      items: res?.items ?? [],
      nextPageToken: res?.nextPageToken,
      nextSyncToken: res?.nextSyncToken,
    };
  }

  /** Every calendar on the user's list. */
  async listCalendars(token: string): Promise<CalendarListItem[]> {
    const items: CalendarListItem[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.call<{
        items?: CalendarListItem[];
        nextPageToken?: string;
      }>(token, "GET", "/users/me/calendarList", undefined, { pageToken });
      items.push(...(res?.items ?? []));
      pageToken = res?.nextPageToken;
    } while (pageToken);
    return items;
  }

  /** Every event starting in the window, recurring ones expanded to single instances. */
  async listWindow(
    token: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<GoogleEventItem[]> {
    const items: GoogleEventItem[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.call<EventPage>(
        token,
        "GET",
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        undefined,
        {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: "true",
          maxResults: "250",
          pageToken,
        },
      );
      items.push(...(res?.items ?? []));
      pageToken = res?.nextPageToken;
    } while (pageToken);
    return items;
  }

  async watch(
    token: string,
    calendarId: string,
    channel: WatchChannel,
  ): Promise<{ resourceId: string; expirationMs: number }> {
    const res = await this.call<{ resourceId: string; expiration: string }>(
      token,
      "POST",
      `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        id: channel.id,
        type: "web_hook",
        address: channel.address,
        token: channel.token,
        expiration: String(channel.expirationMs),
      },
    );
    return {
      resourceId: res!.resourceId,
      expirationMs: Number(res!.expiration),
    };
  }

  async stopChannel(
    token: string,
    channelId: string,
    resourceId: string,
  ): Promise<void> {
    await this.ignoreGone(() =>
      this.call(token, "POST", "/channels/stop", { id: channelId, resourceId }),
    );
  }

  private async ignoreGone(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (
        error instanceof GoogleApiError &&
        (error.status === 404 || error.status === 410)
      )
        return;
      throw error;
    }
  }
}
