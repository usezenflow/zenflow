import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  LAST_USED_WRITE_INTERVAL_MS,
  ApiTokensService,
} from "./api-tokens.service";
import { hashApiToken } from "./api-token.util";

const PEPPER = "pepper-a-that-is-long-enough-123456";
const OTHER_PEPPER = "pepper-b-that-is-long-enough-123456";
const T0 = new Date("2026-10-23T10:00:00.000Z");

interface Row {
  id: string;
  name: string;
  hash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  userId: string;
}

type UpdateManyWhere = {
  id: string;
  OR: Array<{ lastUsedAt: null } | { lastUsedAt: { lte: Date } }>;
};

/** In-memory stand-in for `prisma.apiToken`, honouring the filters the service uses. */
function fakePrisma(users: User[]) {
  const rows: Row[] = [];
  let seq = 0;
  const findByHash = jest.fn(
    (args: {
      where: { hash: { in: string[] } };
      include?: { user: boolean };
    }) => {
      const row = rows.find((r) => args.where.hash.in.includes(r.hash));
      if (!row) return Promise.resolve(null);
      const user = users.find((u) => u.id === row.userId);
      return Promise.resolve(args.include ? { ...row, user } : row);
    },
  );
  const updateMany = jest.fn(
    (args: { where: UpdateManyWhere; data: Partial<Row> }) => {
      let count = 0;
      for (const row of rows) {
        if (row.id !== args.where.id) continue;
        const eligible = args.where.OR.some((clause) =>
          clause.lastUsedAt === null
            ? row.lastUsedAt === null
            : row.lastUsedAt !== null &&
              row.lastUsedAt <= clause.lastUsedAt.lte,
        );
        if (eligible) {
          Object.assign(row, args.data);
          count++;
        }
      }
      return Promise.resolve({ count });
    },
  );
  const apiToken = {
    create: jest.fn(
      (args: { data: { name: string; hash: string; userId: string } }) => {
        const row: Row = {
          id: `tok-${++seq}`,
          name: args.data.name,
          hash: args.data.hash,
          createdAt: T0,
          lastUsedAt: null,
          revokedAt: null,
          userId: args.data.userId,
        };
        rows.push(row);
        return Promise.resolve(row);
      },
    ),
    findMany: jest.fn((args: { where: { userId: string; revokedAt: null } }) =>
      Promise.resolve(
        rows.filter(
          (r) => r.userId === args.where.userId && r.revokedAt === null,
        ),
      ),
    ),
    findFirst: jest.fn(
      (args: {
        where: { id?: string; userId?: string; hash?: { in: string[] } };
        include?: { user: boolean };
      }) =>
        args.where.hash
          ? findByHash({
              where: { hash: args.where.hash },
              include: args.include,
            })
          : Promise.resolve(
              rows.find(
                (r) => r.id === args.where.id && r.userId === args.where.userId,
              ) ?? null,
            ),
    ),
    update: jest.fn((args: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (row) Object.assign(row, args.data);
      return Promise.resolve(row);
    }),
    updateMany,
  };
  return { rows, apiToken, findByHash, updateMany };
}

type FakePrisma = ReturnType<typeof fakePrisma>;

async function makeWithVars(
  vars: Record<string, string | undefined>,
  prisma: FakePrisma,
  oAuthToken: unknown = {},
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ApiTokensService,
      {
        provide: PrismaService,
        useValue: { apiToken: prisma.apiToken, oAuthToken },
      },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => vars[key] },
      },
    ],
  }).compile();
  return module.get(ApiTokensService);
}

function make(
  pepper: string | undefined,
  prisma: FakePrisma,
  oAuthToken: unknown = {},
) {
  return makeWithVars({ API_TOKEN_PEPPER_V1: pepper }, prisma, oAuthToken);
}

const alice = {
  id: "u-alice",
  email: "alice@example.com",
  timezone: "UTC",
} as unknown as User;
const bob = {
  id: "u-bob",
  email: "bob@example.com",
  timezone: "UTC",
} as unknown as User;

describe("ApiTokensService", () => {
  it("returns the secret once and stores only its HMAC", async () => {
    const prisma = fakePrisma([alice]);
    const service = await make(PEPPER, prisma);

    const res = await service.create(alice, { name: "ChatGPT" });

    expect(res.secret.startsWith("zf_")).toBe(true);
    expect(res.token).toEqual({
      id: "tok-1",
      name: "ChatGPT",
      createdAt: T0.toISOString(),
      lastUsedAt: null,
    });
    expect(prisma.rows[0].hash).toBe(hashApiToken(res.secret, PEPPER));
    expect(JSON.stringify(prisma.rows)).not.toContain(res.secret);
  });

  it("answers 503 on create when no pepper is configured", async () => {
    const service = await make(undefined, fakePrisma([alice]));
    await expect(service.create(alice, { name: "x" })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("authenticates a live token to its owner", async () => {
    const prisma = fakePrisma([alice]);
    const service = await make(PEPPER, prisma);
    const { secret } = await service.create(alice, { name: "ChatGPT" });

    const user = await service.authenticate(secret, T0);

    expect(user?.id).toBe("u-alice");
  });

  it("rejects a revoked token", async () => {
    const prisma = fakePrisma([alice]);
    const service = await make(PEPPER, prisma);
    const { secret, token } = await service.create(alice, { name: "ChatGPT" });
    await service.revoke(alice, token.id);

    expect(await service.authenticate(secret, T0)).toBeNull();
  });

  it("rejects a secret that was minted under another pepper", async () => {
    const prisma = fakePrisma([alice]);
    const minted = await make(PEPPER, prisma);
    const { secret } = await minted.create(alice, { name: "ChatGPT" });

    const rotated = await make(OTHER_PEPPER, prisma);

    expect(await rotated.authenticate(secret, T0)).toBeNull();
  });

  it("keeps tokens minted under an older pepper valid after rotation", async () => {
    const prisma = fakePrisma([alice]);
    const before = await make(PEPPER, prisma);
    const { secret: old } = await before.create(alice, { name: "old" });

    const rotated = await makeWithVars(
      {
        API_TOKEN_PEPPER_CURRENT_VERSION: "2",
        API_TOKEN_PEPPER_V1: PEPPER,
        API_TOKEN_PEPPER_V2: OTHER_PEPPER,
      },
      prisma,
    );
    const { secret: fresh } = await rotated.create(alice, { name: "new" });

    expect((await rotated.authenticate(old, T0))?.id).toBe(alice.id);
    expect((await rotated.authenticate(fresh, T0))?.id).toBe(alice.id);
    expect(prisma.rows.find((r) => r.name === "new")?.hash).toBe(
      hashApiToken(fresh, OTHER_PEPPER),
    );
  });

  it("rejects unknown and foreign-prefix secrets without a lookup", async () => {
    const prisma = fakePrisma([alice]);
    const service = await make(PEPPER, prisma);

    expect(await service.authenticate("zf_unknown", T0)).toBeNull();
    expect(await service.authenticate("Bearer something", T0)).toBeNull();
    expect(prisma.findByHash).toHaveBeenCalledTimes(1);
  });

  it("authenticates a live OAuth access token and refuses an expired one", async () => {
    const expiresAt = new Date(T0.getTime() + 60_000);
    const stored = {
      hash: hashApiToken("zo_live", PEPPER),
      expiresAt,
      user: alice,
    };
    const oAuthToken = {
      findFirst: jest.fn(
        (args: {
          where: {
            hash: { in: string[] };
            kind: string;
            expiresAt: { gt: Date };
          };
        }) =>
          Promise.resolve(
            args.where.hash.in.includes(stored.hash) &&
              args.where.kind === "ACCESS" &&
              stored.expiresAt > args.where.expiresAt.gt
              ? stored
              : null,
          ),
      ),
    };
    const service = await make(PEPPER, fakePrisma([alice]), oAuthToken);

    expect((await service.authenticate("zo_live", T0))?.id).toBe("u-alice");
    expect(
      await service.authenticate("zo_live", new Date(T0.getTime() + 120_000)),
    ).toBeNull();
    expect(await service.authenticate("zo_other", T0)).toBeNull();
  });

  it("stamps lastUsedAt at most once per interval", async () => {
    const prisma = fakePrisma([alice]);
    const service = await make(PEPPER, prisma);
    const { secret } = await service.create(alice, { name: "ChatGPT" });

    await service.authenticate(secret, T0);
    expect(prisma.rows[0].lastUsedAt).toEqual(T0);

    const soon = new Date(T0.getTime() + 60_000);
    await service.authenticate(secret, soon);
    expect(prisma.rows[0].lastUsedAt).toEqual(T0);
    expect(prisma.updateMany).toHaveBeenCalledTimes(1);

    const later = new Date(T0.getTime() + LAST_USED_WRITE_INTERVAL_MS + 1);
    await service.authenticate(secret, later);
    expect(prisma.rows[0].lastUsedAt).toEqual(later);
    expect(prisma.updateMany).toHaveBeenCalledTimes(2);
  });

  it("lists only the caller's live tokens", async () => {
    const prisma = fakePrisma([alice, bob]);
    const service = await make(PEPPER, prisma);
    const first = await service.create(alice, { name: "one" });
    await service.create(alice, { name: "two" });
    await service.create(bob, { name: "bob's" });
    await service.revoke(alice, first.token.id);

    const names = (await service.list(alice)).map((t) => t.name);

    expect(names).toEqual(["two"]);
  });

  it("does not revoke another user's token", async () => {
    const prisma = fakePrisma([alice, bob]);
    const service = await make(PEPPER, prisma);
    const { token, secret } = await service.create(alice, { name: "ChatGPT" });

    await expect(service.revoke(bob, token.id)).rejects.toThrow(
      NotFoundException,
    );
    expect(await service.authenticate(secret, T0)).not.toBeNull();
  });
});
