import { CryptoService } from "../crypto/crypto.service";
import { MasterKeyService } from "../crypto/master-key.service";
import { UpstreamSessionRejectedError } from "../common/upstream-session-rejected.exception";
import { PrismaService } from "../prisma/prisma.service";
import {
  UpstreamSessionCache,
  upstreamKey,
  upstreamTtlSeconds,
} from "./upstream-session-cache.service";

const USER = "u1";
const DEK = Buffer.alloc(32, 7);

/** An in-memory Redis for the commands the cache uses. */
function redisDouble() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    del: jest.fn((...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return Promise.resolve(keys.length);
    }),
  };
}

function build(options: { hasKey?: boolean } = {}) {
  const redis = redisDouble();
  const prisma = {
    userEncryptionKey: {
      findFirst: jest.fn().mockResolvedValue(
        options.hasKey === false
          ? null
          : {
              key: "k",
              iv: "i",
              authTag: "a",
              masterKeyVersion: 1,
              algorithm: "aes-256-gcm",
            },
      ),
    },
  };
  const masterKeys = { unwrap: jest.fn(() => DEK) };
  const cache = new UpstreamSessionCache(
    redis as never,
    prisma as unknown as PrismaService,
    new CryptoService(),
    masterKeys as unknown as MasterKeyService,
  );
  return { cache, redis, prisma };
}

describe("UpstreamSessionCache", () => {
  it("logs in once, then serves the cached session without a second login", async () => {
    const { cache } = build();
    const login = jest.fn().mockResolvedValue({ ok: true, token: "t1" });

    const first = await cache.getOrLogin(USER, "portal", login);
    const second = await cache.getOrLogin(USER, "portal", login);

    expect(first).toEqual({ ok: true, token: "t1" });
    expect(second).toEqual({ ok: true, token: "t1" });
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("stores only the sealed value, never the plaintext token", async () => {
    const { cache, redis } = build();

    await cache.getOrLogin(USER, "portal", () =>
      Promise.resolve({ ok: true, token: "secret-token" }),
    );

    const raw = redis.store.get(upstreamKey(USER, "portal")) as string;
    expect(raw).not.toContain("secret-token");
    expect(redis.set).toHaveBeenCalledWith(
      upstreamKey(USER, "portal"),
      expect.any(String),
      "EX",
      100 * 60,
    );
  });

  it("does not cache a rejected login, so the next call tries again", async () => {
    const { cache, redis } = build();
    const login = jest.fn().mockResolvedValue({ ok: false });

    await cache.getOrLogin(USER, "portal", login);
    await cache.getOrLogin(USER, "portal", login);

    expect(login).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("shares one login between concurrent callers", async () => {
    const { cache } = build();
    let release!: (v: { ok: true; token: string }) => void;
    const login = jest.fn(
      () =>
        new Promise<{ ok: true; token: string }>(
          (resolve) => (release = resolve),
        ),
    );

    const a = cache.getOrLogin(USER, "lms", login);
    const b = cache.getOrLogin(USER, "lms", login);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ ok: true, token: "shared" });

    await expect(Promise.all([a, b])).resolves.toEqual([
      { ok: true, token: "shared" },
      { ok: true, token: "shared" },
    ]);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("re-logs in when the stored value no longer opens", async () => {
    const { cache, redis } = build();
    redis.store.set(
      upstreamKey(USER, "portal"),
      JSON.stringify({ iv: "00", authTag: "00", encrypted: "00" }),
    );
    const login = jest.fn().mockResolvedValue({ ok: true, token: "fresh" });

    const res = await cache.getOrLogin(USER, "portal", login);

    expect(res).toEqual({ ok: true, token: "fresh" });
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("logs in every time when the student has no data key", async () => {
    const { cache, redis } = build({ hasKey: false });
    const login = jest.fn().mockResolvedValue({ ok: true, token: "t" });

    await cache.getOrLogin(USER, "portal", login);
    await cache.getOrLogin(USER, "portal", login);

    expect(login).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  describe("withSession", () => {
    it("runs on a cached session without signing in again", async () => {
      const { cache } = build();
      const login = jest.fn(() =>
        Promise.resolve({ ok: true as const, token: "t1" }),
      );
      await cache.getOrLogin(USER, "portal", login);

      const outcome = await cache.withSession(USER, "portal", login, (s) =>
        Promise.resolve(s.token),
      );

      expect(outcome).toEqual({ ok: true, value: "t1" });
      expect(login).toHaveBeenCalledTimes(1);
    });

    it("drops a rejected session, signs in once more and retries once", async () => {
      const { cache, redis } = build();
      await cache.getOrLogin(USER, "portal", () =>
        Promise.resolve({ ok: true, token: "stale" }),
      );
      expect(redis.store.has(upstreamKey(USER, "portal"))).toBe(true);
      const login = jest.fn().mockResolvedValue({ ok: true, token: "fresh" });
      const use = jest
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(new UpstreamSessionRejectedError("portal")),
        )
        .mockImplementationOnce((s: { token: string }) =>
          Promise.resolve(s.token),
        );

      const outcome = await cache.withSession(USER, "portal", login, use);

      expect(outcome).toEqual({ ok: true, value: "fresh" });
      expect(login).toHaveBeenCalledTimes(1);
      expect(use).toHaveBeenCalledTimes(2);
    });

    it("does not loop when the fresh session is rejected too", async () => {
      const { cache } = build();
      const login = jest.fn().mockResolvedValue({ ok: true, token: "t" });
      const use = jest
        .fn()
        .mockRejectedValue(new UpstreamSessionRejectedError("lms"));

      await expect(
        cache.withSession(USER, "lms", login, use),
      ).rejects.toBeInstanceOf(UpstreamSessionRejectedError);
      expect(use).toHaveBeenCalledTimes(2);
      expect(login).toHaveBeenCalledTimes(2);
    });

    it("reports a refused sign-in without running the work", async () => {
      const { cache } = build();
      const login = jest.fn().mockResolvedValue({ ok: false });
      const use = jest.fn();

      await expect(
        cache.withSession(USER, "portal", login, use),
      ).resolves.toEqual({ ok: false });
      expect(use).not.toHaveBeenCalled();
    });

    it("passes other errors through without a retry", async () => {
      const { cache } = build();
      const login = jest.fn().mockResolvedValue({ ok: true, token: "t" });
      const use = jest.fn().mockRejectedValue(new Error("boom"));

      await expect(
        cache.withSession(USER, "portal", login, use),
      ).rejects.toThrow("boom");
      expect(use).toHaveBeenCalledTimes(1);
    });
  });

  it("drops every kind for a student on clear", async () => {
    const { cache, redis } = build();
    await cache.getOrLogin(USER, "portal", () =>
      Promise.resolve({ ok: true, token: "t" }),
    );
    await cache.getOrLogin(USER, "lms", () =>
      Promise.resolve({ ok: true, token: "t" }),
    );

    await cache.clear(USER);

    expect(redis.store.size).toBe(0);
  });

  it("falls back to a login when Redis is down", async () => {
    const { cache, redis } = build();
    redis.get.mockRejectedValueOnce(new Error("down"));
    const login = jest.fn().mockResolvedValue({ ok: true, token: "t" });

    await expect(cache.getOrLogin(USER, "portal", login)).resolves.toEqual({
      ok: true,
      token: "t",
    });
  });
});

describe("upstreamTtlSeconds", () => {
  it("keeps the defaults when no override is set", () => {
    expect(upstreamTtlSeconds("portal", {})).toBe(100 * 60);
    expect(upstreamTtlSeconds("dkhp", {})).toBe(100 * 60);
    expect(upstreamTtlSeconds("lms", {})).toBe(50 * 60);
  });

  it("reads the override per kind, with dkhp sharing the portal variable", () => {
    const env = {
      UPSTREAM_SESSION_TTL_PORTAL_S: "900",
      UPSTREAM_SESSION_TTL_LMS_S: "300",
    };
    expect(upstreamTtlSeconds("portal", env)).toBe(900);
    expect(upstreamTtlSeconds("dkhp", env)).toBe(900);
    expect(upstreamTtlSeconds("lms", env)).toBe(300);
  });

  it("treats 0 as off and an invalid value as the default", () => {
    expect(upstreamTtlSeconds("lms", { UPSTREAM_SESSION_TTL_LMS_S: "0" })).toBe(
      0,
    );
    expect(
      upstreamTtlSeconds("lms", { UPSTREAM_SESSION_TTL_LMS_S: "soon" }),
    ).toBe(50 * 60);
    expect(
      upstreamTtlSeconds("lms", { UPSTREAM_SESSION_TTL_LMS_S: "-5" }),
    ).toBe(50 * 60);
  });
});

describe("UpstreamSessionCache with the cache off", () => {
  const original = process.env.UPSTREAM_SESSION_TTL_PORTAL_S;
  beforeEach(() => {
    process.env.UPSTREAM_SESSION_TTL_PORTAL_S = "0";
  });
  afterEach(() => {
    if (original === undefined)
      delete process.env.UPSTREAM_SESSION_TTL_PORTAL_S;
    else process.env.UPSTREAM_SESSION_TTL_PORTAL_S = original;
  });

  it("logs in on every call and stores nothing", async () => {
    const { cache, redis } = build();
    const login = jest.fn().mockResolvedValue({ ok: true, token: "t1" });

    await cache.getOrLogin(USER, "portal", login);
    await cache.getOrLogin(USER, "portal", login);

    expect(login).toHaveBeenCalledTimes(2);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
