import { CommuteDefaultsService } from "./commute-defaults.service";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const HOME = { lat: 11.94, lng: 108.43 };

function makeService(options: {
  user?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  route?: { distanceMeters: number; durationSeconds: number } | null;
}) {
  const user =
    options.user === undefined
      ? {
          homeLocation: "Home",
          homeLat: HOME.lat,
          homeLng: HOME.lng,
          defaultTransport: "MOTORCYCLE",
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
    route: jest
      .fn()
      .mockResolvedValue(
        options.route === undefined
          ? { distanceMeters: 5000, durationSeconds: 600, coordinates: [] }
          : options.route,
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

    await expect(service.apply("u1", NOW)).resolves.toBe(1);

    expect(places.route).toHaveBeenCalledWith(
      "car",
      HOME,
      expect.objectContaining({ lat: expect.any(Number) as number }),
    );
    // 5 km at 30 km/h.
    expect(session.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] }, userId: "u1" },
      data: {
        originLocation: "Home",
        originLat: HOME.lat,
        originLng: HOME.lng,
        commuteMinutes: 10,
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

    await service.apply("u1", NOW);

    expect(places.route).toHaveBeenCalledTimes(1);
  });

  it("skips a room that is not a campus place", async () => {
    const { service, session, places } = makeService({
      rows: [
        { id: "a", location: "Zoom", locationLat: null, locationLng: null },
      ],
    });

    await expect(service.apply("u1", NOW)).resolves.toBe(0);

    expect(places.route).not.toHaveBeenCalled();
    expect(session.updateMany).not.toHaveBeenCalled();
  });

  it("uses a pinned point over the name", async () => {
    const { service, places } = makeService({
      rows: [
        { id: "a", location: "Cafe", locationLat: 11.95, locationLng: 108.44 },
      ],
    });

    await service.apply("u1", NOW);

    expect(places.route).toHaveBeenCalledWith("car", HOME, {
      lat: 11.95,
      lng: 108.44,
    });
  });

  it("leaves rows alone when there is no route", async () => {
    const { service, session } = makeService({
      rows: [{ id: "a", location: "A8", locationLat: null, locationLng: null }],
      route: null,
    });

    await expect(service.apply("u1", NOW)).resolves.toBe(0);

    expect(session.updateMany).not.toHaveBeenCalled();
  });

  it("only picks rows the student has not set up", async () => {
    const { service, session } = makeService({ rows: [] });

    await service.apply("u1", NOW);

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

  it("takes back what it filled when the home is cleared", async () => {
    const { service, session } = makeService({
      user: {
        homeLocation: null,
        homeLat: null,
        homeLng: null,
        defaultTransport: null,
      },
    });

    await expect(service.apply("u1", NOW)).resolves.toBe(3);

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
