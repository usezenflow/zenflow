import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { SessionsService } from "../sessions/sessions.service";
import { CalendarPullService } from "./calendar-pull.service";
import { CalendarSyncService } from "./calendar-sync.service";
import {
  GoogleApiError,
  GoogleCalendarClient,
  type GoogleEventItem,
} from "./google-calendar.client";
import { GoogleOAuthService } from "./google-oauth.service";

const USER = "user-1";
const WRITTEN = new Date("2026-11-01T00:00:00Z");

const link = {
  id: "link-1",
  userId: USER,
  eventId: "aaaa1",
  sessionId: "aaaa-1",
  seriesId: null,
  etag: '"mine"',
  syncedAt: WRITTEN,
};
const baseSession = {
  id: "aaaa-1",
  deleted: false,
  source: "USER",
  durationMinutes: 60,
  scheduledStartTime: new Date("2026-11-03T02:00:00Z"),
  updatedAt: new Date("2026-10-31T00:00:00Z"),
};

const event = (over: Partial<GoogleEventItem> = {}): GoogleEventItem => ({
  id: "aaaa1",
  etag: '"theirs"',
  status: "confirmed",
  start: { dateTime: "2026-11-03T04:00:00Z" },
  end: { dateTime: "2026-11-03T05:00:00Z" },
  extendedProperties: { private: { zf: "aaaa-1", zfk: "s" } },
  ...over,
});

async function setup(
  opts: {
    session?: Partial<typeof baseSession> | null;
    links?: unknown[];
    syncToken?: string | null;
  } = {},
) {
  const prisma = {
    calendarConnection: {
      findUnique: jest.fn().mockResolvedValue({
        status: "ACTIVE",
        refreshTokenEnc: "sealed",
        googleCalendarId: "cal-1",
        syncToken: opts.syncToken === undefined ? "token-1" : opts.syncToken,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    calendarLink: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.links ? opts.links[0] : link),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    session: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.session === null ? null : { ...baseSession, ...opts.session },
        ),
    },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: USER }) },
  };
  const client = { listEvents: jest.fn() };
  const sessions = {
    update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue({}),
  };
  const sync = { needsReconnect: jest.fn() };
  const module = await Test.createTestingModule({
    providers: [
      CalendarPullService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: GoogleOAuthService,
        useValue: { accessToken: jest.fn().mockResolvedValue("access") },
      },
      { provide: GoogleCalendarClient, useValue: client },
      { provide: SessionsService, useValue: sessions },
      { provide: CalendarSyncService, useValue: sync },
    ],
  }).compile();
  const page = (items: GoogleEventItem[]) =>
    client.listEvents.mockResolvedValue({ items, nextSyncToken: "token-2" });
  return {
    service: module.get(CalendarPullService),
    prisma,
    client,
    sessions,
    sync,
    page,
  };
}

describe("CalendarPullService", () => {
  it("moves a session when the user drags its event", async () => {
    const { service, page, sessions, prisma } = await setup();
    page([event()]);

    const summary = await service.pullUser(USER);

    expect(summary).toEqual({ applied: 1, restored: 0 });
    expect(sessions.update).toHaveBeenCalledWith(
      "aaaa-1",
      { scheduledStartTime: "2026-11-03T04:00:00.000Z", durationMinutes: 60 },
      { id: USER },
    );
    expect(prisma.calendarConnection.update).toHaveBeenCalledWith({
      where: { userId: USER },
      data: { syncToken: "token-2" },
    });
  });

  it("snaps an off-grid drop to the 15 minute grid", async () => {
    const { service, page, sessions } = await setup();
    page([
      event({
        start: { dateTime: "2026-11-03T04:07:00Z" },
        end: { dateTime: "2026-11-03T05:37:00Z" },
      }),
    ]);

    await service.pullUser(USER);

    expect(sessions.update).toHaveBeenCalledWith(
      "aaaa-1",
      { scheduledStartTime: "2026-11-03T04:00:00.000Z", durationMinutes: 90 },
      { id: USER },
    );
  });

  it("ignores the echo of its own write", async () => {
    const { service, page, sessions } = await setup();
    page([event({ etag: '"mine"' })]);

    expect(await service.pullUser(USER)).toEqual({ applied: 0, restored: 0 });
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it("keeps the Zenflow version when it changed after the last write", async () => {
    const { service, page, sessions, prisma } = await setup({
      session: { updatedAt: new Date("2026-11-01T00:05:00Z") },
    });
    page([event()]);

    expect(await service.pullUser(USER)).toEqual({ applied: 0, restored: 1 });
    expect(sessions.update).not.toHaveBeenCalled();
    expect(prisma.calendarLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { payloadHash: "" },
    });
  });

  it("writes the event back when Zenflow refuses the move", async () => {
    const { service, page, sessions } = await setup();
    sessions.update.mockRejectedValue(
      new Error("Timetable items can't be moved"),
    );
    page([event()]);

    expect(await service.pullUser(USER)).toEqual({ applied: 0, restored: 1 });
  });

  it("removes a user task whose event was deleted", async () => {
    const { service, page, sessions, prisma } = await setup();
    page([event({ status: "cancelled" })]);

    expect(await service.pullUser(USER)).toEqual({ applied: 1, restored: 0 });
    expect(sessions.remove).toHaveBeenCalledWith("aaaa-1", { id: USER });
    expect(prisma.calendarLink.delete).toHaveBeenCalledWith({
      where: { id: "link-1" },
    });
  });

  it("recreates the event of an ingested timetable item that was deleted", async () => {
    const { service, page, sessions } = await setup({
      session: { source: "PORTAL" },
    });
    page([event({ status: "cancelled" })]);

    expect(await service.pullUser(USER)).toEqual({ applied: 0, restored: 1 });
    expect(sessions.remove).not.toHaveBeenCalled();
  });

  it("ignores events Zenflow did not write and single instances of a series", async () => {
    const { service, page, prisma } = await setup();
    page([
      event({ extendedProperties: undefined }),
      event({ recurringEventId: "series1" }),
    ]);

    expect(await service.pullUser(USER)).toEqual({ applied: 0, restored: 0 });
    expect(prisma.calendarLink.findUnique).not.toHaveBeenCalled();
  });

  it("only stores a token on the first pull", async () => {
    const { service, page, sessions, client } = await setup({
      syncToken: null,
    });
    page([event()]);

    await service.pullUser(USER);

    expect(client.listEvents).toHaveBeenCalledWith("access", "cal-1", {
      pageToken: undefined,
    });
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it("starts over when Google expires the sync token", async () => {
    const { service, client, prisma } = await setup();
    client.listEvents
      .mockRejectedValueOnce(
        new GoogleApiError(410, "fullSyncRequired", "gone"),
      )
      .mockResolvedValueOnce({ items: [], nextSyncToken: "fresh" });

    await service.pullUser(USER);

    expect(prisma.calendarConnection.update).toHaveBeenCalledWith({
      where: { userId: USER },
      data: { syncToken: "fresh" },
    });
  });

  it("asks the user to reconnect when access is revoked", async () => {
    const { service, client, sync } = await setup();
    client.listEvents.mockRejectedValue(
      new GoogleApiError(400, "invalid_grant", "revoked"),
    );

    await service.pullUser(USER);

    expect(sync.needsReconnect).toHaveBeenCalledWith(
      USER,
      "Google access was revoked",
    );
  });
});
