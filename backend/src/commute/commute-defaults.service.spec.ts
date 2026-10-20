import { CommuteDefaultsService } from "./commute-defaults.service";

const HOME = { lat: 11.94, lng: 108.43 };

function makeService(options: {
  user?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  commute?: { minutes: number } | null;
}) {
  const user =
    options.user === undefined
      ? {
          homeLocation: "Home",
          homeLat: HOME.lat,
          homeLng: HOME.lng,
          defaultTransport: "MOTORCYCLE",
          timezone: "Asia/Ho_Chi_Minh",
        }
      : options.user;
  const session = {
    findMany: jest.fn().mockResolvedValue(options.rows ?? []),
    updateMany: jest
      .fn()
      .mockImplementation(({ where }: { where: { id?: { in: string[] } } }) =>
        Promise.resolve({ count: where.id?.in.length ?? 3 }),
      ),
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    session,
  };
  const places = {
    commute: jest
      .fn()
      .mockResolvedValue(
        options.commute === undefined ? { minutes: 14 } : options.commute,
      ),
  };
  const service = new CommuteDefaultsService(prisma as never, places as never);
  return { service, session, places };
}

describe("CommuteDefaultsService", () => {
  it("fills the home start and motorbike minutes for a campus room", async () => {
    const { service, session, places } = makeService({
      rows: [
        { id: "a", location: "A8 - 101", locationLat: null, locationLng: null },
      ],
    });

    await expect(service.apply("u1")).resolves.toBe(1);

    expect(places.commute).toHaveBeenCalledWith(
      "MOTORCYCLE",
      HOME,
      expect.objectContaining({ lat: expect.any(Number) as number }),
      false,
    );
    // Ride to the library parking plus the walk inside.
    expect(session.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] }, userId: "u1" },
      data: {
        originLocation: "Home",
        originLat: HOME.lat,
        originLng: HOME.lng,
        commuteMinutes: 14,
        commuteAuto: true,
      },
    });
  });

  it("routes once per destination", async () => {
    const { service, places } = makeService({
      rows: [
        { id: "a", location: "A8", locationLat: null, locationLng: null },
        { id: "b", location: "A8 - 202", locationLat: null, locationLng: null },
      ],
    });

    await service.apply("u1");

    expect(places.commute).toHaveBeenCalledTimes(1);
  });

  it("skips a room that is not a campus place", async () => {
    const { service, session, places } = makeService({
      rows: [
        { id: "a", location: "Zoom", locationLat: null, locationLng: null },
      ],
    });

    await expect(service.apply("u1")).resolves.toBe(0);

    expect(places.commute).not.toHaveBeenCalled();
    expect(session.updateMany).not.toHaveBeenCalled();
  });

  it("uses a pinned point over the name", async () => {
    const { service, places } = makeService({
      rows: [
        { id: "a", location: "Cafe", locationLat: 11.95, locationLng: 108.44 },
      ],
    });

    await service.apply("u1");

    expect(places.commute).toHaveBeenCalledWith(
      "MOTORCYCLE",
      HOME,
      { lat: 11.95, lng: 108.44 },
      false,
    );
  });

  it("rides inside the campus for a session that starts after 6pm", async () => {
    const { service, places } = makeService({
      rows: [
        {
          id: "a",
          location: "A8 - 101",
          locationLat: null,
          locationLng: null,
          // 19:00 in Ho Chi Minh City (UTC+7).
          scheduledStartTime: new Date("2026-10-20T12:00:00Z"),
        },
      ],
    });

    await service.apply("u1");

    expect(places.commute).toHaveBeenCalledWith(
      "MOTORCYCLE",
      HOME,
      expect.objectContaining({ lat: expect.any(Number) as number }),
      true,
    );
  });

  it("leaves rows alone when there is no route", async () => {
    const { service, session } = makeService({
      rows: [{ id: "a", location: "A8", locationLat: null, locationLng: null }],
      commute: null,
    });

    await expect(service.apply("u1")).resolves.toBe(0);

    expect(session.updateMany).not.toHaveBeenCalled();
  });

  it("only picks rows the student has not set up", async () => {
    const { service, session } = makeService({ rows: [] });

    await service.apply("u1");

    expect(session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { commuteAuto: true },
            { originLocation: null, commuteMinutes: null },
          ],
        }) as unknown,
      }),
    );
  });

  it("reads every page and past sessions too", async () => {
    const page = (from: number) =>
      Array.from({ length: 500 }, (_, i) => ({
        id: `s${from + i}`,
        location: "A8",
        locationLat: null,
        locationLng: null,
      }));
    const { service, session } = makeService({});
    session.findMany
      .mockResolvedValueOnce(page(0))
      .mockResolvedValueOnce(page(500).slice(0, 3));

    await service.apply("u1");

    expect(session.findMany).toHaveBeenCalledTimes(2);
    const calls = session.findMany.mock.calls as [
      { where: Record<string, unknown> },
    ][];
    expect(calls[0][0].where).not.toHaveProperty("scheduledStartTime");
    expect(calls[1][0]).toMatchObject({
      cursor: { id: "s499" },
      skip: 1,
    });
  });

  it("takes back what it filled when the home is cleared", async () => {
    const { service, session } = makeService({
      user: {
        homeLocation: null,
        homeLat: null,
        homeLng: null,
        defaultTransport: null,
      },
    });

    await expect(service.apply("u1")).resolves.toBe(3);

    expect(session.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", commuteAuto: true },
      data: {
        originLocation: null,
        originLat: null,
        originLng: null,
        commuteMinutes: null,
        commuteAuto: false,
      },
    });
    expect(session.findMany).not.toHaveBeenCalled();
  });
});
