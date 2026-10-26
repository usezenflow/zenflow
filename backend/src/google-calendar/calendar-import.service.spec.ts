import { CalendarImportService, busyBlock } from "./calendar-import.service";
import type { GoogleEventItem } from "./google-calendar.client";

const NOW = new Date("2026-11-01T00:00:00Z");
const USER = "user-1";

const timed = (over: Partial<GoogleEventItem> = {}): GoogleEventItem => ({
  id: "ev-1",
  status: "confirmed",
  summary: "Lab",
  start: { dateTime: "2026-11-03T02:10:00Z" },
  end: { dateTime: "2026-11-03T03:05:00Z" },
  ...over,
});

function setup(items: GoogleEventItem[], existing: unknown[] = []) {
  const prisma = {
    session: {
      findMany: jest.fn().mockResolvedValue(existing),
      create: jest.fn((args: unknown) => ({ create: args })),
      update: jest.fn((args: unknown) => ({ update: args })),
    },
    $transaction: jest.fn((writes: unknown[]) => Promise.resolve(writes)),
  };
  const client = {
    listCalendars: jest.fn().mockResolvedValue([
      { id: "cal-1", selected: true },
      { id: "cal-own", selected: true },
      { id: "cal-hidden", selected: false },
    ]),
    listWindow: jest.fn().mockResolvedValue(items),
  };
  const service = new CalendarImportService(prisma as never, client as never);
  return { service, prisma, client };
}

describe("busyBlock", () => {
  it("covers the whole event in 15-minute slots", () => {
    expect(busyBlock(timed())).toEqual({
      start: new Date("2026-11-03T02:00:00Z"),
      durationMinutes: 75,
    });
  });

  it("skips all-day and empty events", () => {
    expect(busyBlock({ id: "a", start: { date: "2026-11-03" } })).toBeNull();
    expect(
      busyBlock(timed({ end: { dateTime: "2026-11-03T02:10:00Z" } })),
    ).toBeNull();
  });
});

describe("CalendarImportService.importUser", () => {
  it("creates busy DND sessions for other selected calendars only", async () => {
    const { service, prisma, client } = setup([timed()]);
    await service.importUser(USER, "token", "cal-own", NOW);

    expect(client.listWindow).toHaveBeenCalledTimes(1);
    expect(client.listWindow).toHaveBeenCalledWith(
      "token",
      "cal-1",
      expect.any(Date),
      expect.any(Date),
    );
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: {
        userId: USER,
        externalKey: "google:cal-1:ev-1",
        source: "GOOGLE",
        type: "DND",
        title: "Lab",
        durationMinutes: 75,
        scheduledStartTime: new Date("2026-11-03T02:00:00Z"),
      },
    });
  });

  it("ignores Zenflow's own, cancelled and free events", async () => {
    const { service, prisma } = setup([
      timed({ id: "z", extendedProperties: { private: { zf: "abc" } } }),
      timed({ id: "c", status: "cancelled" }),
      timed({ id: "f", transparency: "transparent" }),
    ]);
    await service.importUser(USER, "token", "cal-own", NOW);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it("hides a block whose event is gone, and leaves rows outside the window", async () => {
    const { service, prisma } = setup(
      [],
      [
        {
          id: "s1",
          externalKey: "google:cal-1:old",
          title: "Gone",
          scheduledStartTime: new Date("2026-11-02T00:00:00Z"),
          durationMinutes: 60,
          deleted: false,
        },
        {
          id: "s2",
          externalKey: "google:cal-1:far",
          title: "Far",
          scheduledStartTime: new Date("2026-06-01T00:00:00Z"),
          durationMinutes: 60,
          deleted: false,
        },
      ],
    );
    await service.importUser(USER, "token", "cal-own", NOW);
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { deleted: true },
    });
  });
});
