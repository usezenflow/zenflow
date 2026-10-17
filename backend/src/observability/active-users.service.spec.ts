import {
  ActiveUsersService,
  activeDayKey,
  activeDayKeys,
} from "./active-users.service";
import { activeUsers } from "./metrics";

const NOW = new Date("2026-10-17T10:00:00.000Z");

function redisDouble() {
  const multi = {
    pfadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  return {
    multi: jest.fn(() => multi),
    pfcount: jest.fn().mockResolvedValue(0),
    multiMock: multi,
  };
}

describe("activeDayKeys", () => {
  it("keys one UTC day per entry, today first", () => {
    expect(activeDayKeys(NOW, 3)).toEqual([
      "active:users:2026-10-17",
      "active:users:2026-10-16",
      "active:users:2026-10-15",
    ]);
  });

  it("uses the UTC date, not the local one", () => {
    expect(activeDayKey(new Date("2026-10-17T23:30:00.000Z"))).toBe(
      "active:users:2026-10-17",
    );
  });
});

describe("ActiveUsersService", () => {
  it("adds the user to today's HyperLogLog and expires it after eight days", async () => {
    const redis = redisDouble();
    const service = new ActiveUsersService(redis as never);

    await service.record("u1", NOW);

    expect(redis.multiMock.pfadd).toHaveBeenCalledWith(
      "active:users:2026-10-17",
      "u1",
    );
    expect(redis.multiMock.expire).toHaveBeenCalledWith(
      "active:users:2026-10-17",
      8 * 24 * 60 * 60,
    );
  });

  it("swallows a Redis failure on record", async () => {
    const redis = redisDouble();
    redis.multiMock.exec.mockRejectedValue(new Error("down"));
    const service = new ActiveUsersService(redis as never);

    await expect(service.record("u1", NOW)).resolves.toBeUndefined();
  });

  it("sets DAU from today and WAU from the union of the last seven days", async () => {
    const redis = redisDouble();
    redis.pfcount.mockResolvedValueOnce(4).mockResolvedValueOnce(9);
    const service = new ActiveUsersService(redis as never);

    await service.refresh(NOW);

    expect(redis.pfcount).toHaveBeenNthCalledWith(1, "active:users:2026-10-17");
    expect(redis.pfcount).toHaveBeenNthCalledWith(2, ...activeDayKeys(NOW, 7));
    expect(activeUsers).toEqual({ dau: 4, wau: 9 });
  });
});
