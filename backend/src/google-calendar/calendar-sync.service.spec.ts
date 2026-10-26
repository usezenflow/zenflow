import { Test } from "@nestjs/testing";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { GoogleApiError, GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarConfig } from "./google-calendar.config";
import { GoogleOAuthService } from "./google-oauth.service";

const NOW = new Date("2026-11-01T00:00:00Z");
const USER = "user-1";

interface SessionRow {
  id: string;
  title: string;
  type: "TASK" | "LECTURE";
  location: string | null;
  durationMinutes: number;
  deadline: Date | null;
  scheduledStartTime: Date;
  attendees: string[];
  alive?: boolean;
}

const session = (id: string, over: Partial<SessionRow> = {}): SessionRow => ({
  id,
  title: `Task ${id}`,
  type: "TASK",
  location: null,
  durationMinutes: 60,
  deadline: null,
  attendees: [],
  scheduledStartTime: new Date("2026-11-03T02:00:00Z"),
  ...over,
});

interface Link {
  id: string;
  userId: string;
  eventId: string;
  sessionId: string | null;
  seriesId: string | null;
  payloadHash: string;
  etag: string | null;
}

async function setup(
  opts: { sessions?: SessionRow[]; links?: Link[]; status?: string } = {},
) {
  const db = {
    sessions: opts.sessions ?? [],
    links: opts.links ?? [],
    series: [] as unknown[],
  };
  const connection = {
    status: opts.status ?? "ACTIVE",
    refreshTokenEnc: "sealed",
    googleCalendarId: "cal-1",
  };
  const prisma = {
    calendarConnection: {
      findUnique: jest.fn().mockResolvedValue(connection),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        timezone: "Asia/Ho_Chi_Minh",
        defaultReminderMinutes: 10,
        calendarTarget: "GOOGLE",
      }),
    },
    session: {
      findMany: jest.fn(
        (args: {
          where: {
            id?: { in: string[] };
            scheduledStartTime?: { gte: Date; lte: Date };
          };
        }) => {
          if (args.where.id) {
            return Promise.resolve(
              db.sessions
                .filter(
                  (s) => args.where.id!.in.includes(s.id) && s.alive !== false,
                )
                .map((s) => ({ id: s.id })),
            );
          }
          const window = args.where.scheduledStartTime;
          return Promise.resolve(
            db.sessions.filter(
              (s) =>
                s.alive !== false &&
                (!window ||
                  (s.scheduledStartTime >= window.gte &&
                    s.scheduledStartTime <= window.lte)),
            ),
          );
        },
      ),
    },
    sessionSeries: { findMany: jest.fn(() => Promise.resolve(db.series)) },
    calendarLink: {
      findMany: jest.fn(() => Promise.resolve([...db.links])),
      upsert: jest.fn((args: { create: Link; update: Partial<Link> }) => {
        const existing = db.links.find(
          (l) => l.eventId === args.create.eventId,
        );
        if (existing) Object.assign(existing, args.update);
        else db.links.push({ ...args.create, id: `link-${db.links.length}` });
        return Promise.resolve({});
      }),
      delete: jest.fn((args: { where: { id: string } }) => {
        db.links = db.links.filter((l) => l.id !== args.where.id);
        return Promise.resolve({});
      }),
    },
  };
  const client = {
    writeEvent: jest.fn().mockResolvedValue('"etag-1"'),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
  };
  const oauth = {
    accessToken: jest.fn().mockResolvedValue("access"),
    forget: jest.fn(),
  };
  const notifications = { create: jest.fn().mockResolvedValue({}) };

  const module = await Test.createTestingModule({
    providers: [
      CalendarSyncService,
      { provide: PrismaService, useValue: prisma },
      { provide: GoogleCalendarClient, useValue: client },
      { provide: GoogleOAuthService, useValue: oauth },
      {
        provide: GoogleCalendarConfig,
        useValue: { webUrl: "https://app.usezenflow.com" },
      },
      { provide: NotificationsService, useValue: notifications },
    ],
  }).compile();
  return {
    service: module.get(CalendarSyncService),
    db,
    prisma,
    client,
    oauth,
    notifications,
  };
}

describe("CalendarSyncService", () => {
  it("writes an event for each session and records the link", async () => {
    const { service, client, db } = await setup({
      sessions: [session("aaaa-1"), session("bbbb-2", { type: "LECTURE" })],
    });

    const summary = await service.syncUser(USER, NOW);

    expect(summary).toMatchObject({ written: 2, deleted: 0, failed: 0 });
    expect(client.writeEvent).toHaveBeenCalledTimes(2);
    expect(client.writeEvent).toHaveBeenCalledWith(
      "access",
      "cal-1",
      "aaaa1",
      expect.objectContaining({ summary: "Task aaaa-1" }),
      expect.objectContaining({ exists: false }),
    );
    expect(db.links.map((l) => l.eventId).sort()).toEqual(["aaaa1", "bbbb2"]);
  });

  it("changes nothing on a repeat run", async () => {
    const { service, client } = await setup({ sessions: [session("aaaa-1")] });
    await service.syncUser(USER, NOW);
    client.writeEvent.mockClear();

    const summary = await service.syncUser(USER, NOW);

    expect(summary).toMatchObject({ written: 0, deleted: 0 });
    expect(client.writeEvent).not.toHaveBeenCalled();
  });

  it("rewrites only the event whose content changed, as an update", async () => {
    const { service, client, db } = await setup({
      sessions: [session("aaaa-1"), session("bbbb-2")],
    });
    await service.syncUser(USER, NOW);
    client.writeEvent.mockClear();
    db.sessions[0].title = "Renamed";

    const summary = await service.syncUser(USER, NOW);

    expect(summary?.written).toBe(1);
    expect(client.writeEvent).toHaveBeenCalledWith(
      "access",
      "cal-1",
      "aaaa1",
      expect.objectContaining({ summary: "Renamed" }),
      expect.objectContaining({ exists: true }),
    );
  });

  it("deletes the event of a session that is gone", async () => {
    const { service, client, db } = await setup({
      sessions: [session("aaaa-1")],
    });
    await service.syncUser(USER, NOW);
    db.sessions[0].alive = false;

    const summary = await service.syncUser(USER, NOW);

    expect(summary?.deleted).toBe(1);
    expect(client.deleteEvent).toHaveBeenCalledWith("access", "cal-1", "aaaa1");
    expect(db.links).toHaveLength(0);
  });

  it("keeps the event of a session that merely left the sync window", async () => {
    const old = session("aaaa-1", {
      scheduledStartTime: new Date("2026-01-01T02:00:00Z"),
    });
    const link: Link = {
      id: "link-0",
      userId: USER,
      eventId: "aaaa1",
      sessionId: "aaaa-1",
      seriesId: null,
      payloadHash: "h",
      etag: null,
    };
    const { service, client, db } = await setup({
      sessions: [old],
      links: [link],
    });

    const summary = await service.syncUser(USER, NOW);

    expect(summary).toMatchObject({ written: 0, deleted: 0 });
    expect(client.deleteEvent).not.toHaveBeenCalled();
    expect(db.links).toHaveLength(1);
  });

  it("retries rate limits and carries on with the other events", async () => {
    const { service, client, db } = await setup({
      sessions: [session("aaaa-1"), session("bbbb-2")],
    });
    client.writeEvent.mockImplementation(
      (_t: string, _c: string, eventId: string) =>
        eventId === "aaaa1"
          ? Promise.reject(
              new GoogleApiError(429, "rateLimitExceeded", "slow down"),
            )
          : Promise.resolve('"etag"'),
    );

    const summary = await service.syncUser(USER, NOW);

    expect(summary).toMatchObject({ written: 1, failed: 1, retryable: 1 });
    expect(db.links.map((l) => l.eventId)).toEqual(["bbbb2"]);
  });

  it("does not retry a permanent failure", async () => {
    const { service, client } = await setup({ sessions: [session("aaaa-1")] });
    client.writeEvent.mockRejectedValue(
      new GoogleApiError(400, "invalid", "bad event"),
    );

    const summary = await service.syncUser(USER, NOW);

    expect(summary).toMatchObject({ failed: 1, retryable: 0 });
  });

  it("asks the user to reconnect once when access is revoked", async () => {
    const { service, oauth, notifications, prisma } = await setup({
      sessions: [session("aaaa-1")],
    });
    oauth.accessToken.mockRejectedValue(
      new GoogleApiError(400, "invalid_grant", "revoked"),
    );

    await service.syncUser(USER, NOW);

    expect(prisma.calendarConnection.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, status: "ACTIVE" },
      data: {
        status: "NEEDS_RECONNECT",
        lastError: "Google access was revoked",
      },
    });
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ eventName: "calendar.reconnect" }),
    );
  });

  it("skips users without an active connection", async () => {
    const { service, client } = await setup({
      status: "NEEDS_RECONNECT",
      sessions: [session("aaaa-1")],
    });
    expect(await service.syncUser(USER, NOW)).toBeNull();
    expect(client.writeEvent).not.toHaveBeenCalled();
  });
});
