import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { DiscoveryPushService } from "./discovery-push.service";
import { NotificationsService } from "./notifications.service";

const DAY_MS = 24 * 60 * 60_000;
const FIRST_SYNC = new Date("2026-10-01T00:00:00Z");

describe("DiscoveryPushService", () => {
  let service: DiscoveryPushService;
  let firsts: { userId: string; _min: { syncedAt: Date | null } }[];
  let sent: { userId: string; _count: { _all: number } }[];
  const prisma = {
    calendarLink: { groupBy: jest.fn() },
    notification: { groupBy: jest.fn() },
  };
  const notifications = { create: jest.fn(), notify: jest.fn() };

  beforeEach(async () => {
    firsts = [{ userId: "u1", _min: { syncedAt: FIRST_SYNC } }];
    sent = [];
    prisma.calendarLink.groupBy.mockImplementation(() =>
      Promise.resolve(firsts),
    );
    prisma.notification.groupBy.mockImplementation(() => Promise.resolve(sent));
    notifications.create.mockImplementation((_userId: string, dto: object) =>
      Promise.resolve({ id: "n1", ...dto }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryPushService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(DiscoveryPushService);
    jest.clearAllMocks();
  });

  const at = (days: number) => new Date(FIRST_SYNC.getTime() + days * DAY_MS);

  it("sends nothing before the first push is due", async () => {
    expect(await service.sweep(at(0.5))).toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("sends the day-1 push once it is due, without a session", async () => {
    expect(await service.sweep(at(1))).toBe(1);
    expect(notifications.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        eventName: "discovery.1",
        sessionId: null,
        materializeSession: false,
      }),
    );
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it("waits for day 3 after the first push, then day 7", async () => {
    sent = [{ userId: "u1", _count: { _all: 1 } }];
    expect(await service.sweep(at(2))).toBe(0);
    expect(await service.sweep(at(3))).toBe(1);
    expect(notifications.create).toHaveBeenLastCalledWith(
      "u1",
      expect.objectContaining({ eventName: "discovery.2" }),
    );

    sent = [{ userId: "u1", _count: { _all: 2 } }];
    expect(await service.sweep(at(7))).toBe(1);
    expect(notifications.create).toHaveBeenLastCalledWith(
      "u1",
      expect.objectContaining({ eventName: "discovery.3" }),
    );
  });

  it("never sends more than three", async () => {
    sent = [{ userId: "u1", _count: { _all: 3 } }];
    expect(await service.sweep(at(30))).toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
