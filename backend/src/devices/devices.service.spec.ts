import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { DevicesService } from "./devices.service";
import { WebPushSender } from "./web-push.sender";

interface Row {
  id: string;
  platform: "IOS" | "ANDROID" | "WEB";
  pushToken: string;
  p256dh: string | null;
  auth: string | null;
  userId: string;
  lastSeenAt: Date | null;
}

/** In-memory `userDevice` double: just `upsert` (on pushToken) + `deleteMany`. */
function makePrismaDouble(rows: Row[]) {
  let seq = rows.length;
  const client = {
    userDevice: {
      upsert: (args: {
        where: { pushToken: string };
        create: Omit<Row, "id">;
        update: Partial<Row>;
      }) => {
        const existing = rows.find((r) => r.pushToken === args.where.pushToken);
        if (existing) {
          Object.assign(existing, args.update);
          return Promise.resolve({ id: existing.id });
        }
        const created: Row = { id: `d${++seq}`, ...args.create };
        rows.push(created);
        return Promise.resolve({ id: created.id });
      },
      deleteMany: (args: { where: { pushToken: string; userId: string } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (
            rows[i].pushToken === args.where.pushToken &&
            rows[i].userId === args.where.userId
          ) {
            rows.splice(i, 1);
          }
        }
        return Promise.resolve({ count: before - rows.length });
      },
    },
  };
  return { client, rows };
}

const USER = { id: "u1" } as User;
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const WEB_KEYS = { p256dh: "p256dh-key", auth: "auth-secret" };

async function makeService(
  rows: Row[] = [],
  webPush: { enabled: boolean; publicKey: string | null } = {
    enabled: false,
    publicKey: null,
  },
) {
  const db = makePrismaDouble(rows);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DevicesService,
      { provide: PrismaService, useValue: db.client },
      { provide: WebPushSender, useValue: webPush },
    ],
  }).compile();
  return { db, service: module.get<DevicesService>(DevicesService) };
}

describe("DevicesService", () => {
  describe("registerDevice", () => {
    it("creates a row for a new token, stamping the owner", async () => {
      const { db, service } = await makeService();

      const { id } = await service.registerDevice(USER, {
        platform: "ANDROID",
        pushToken: "tok-a",
        p256dh: null,
        auth: null,
      });

      expect(id).toBeDefined();
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0]).toMatchObject({
        pushToken: "tok-a",
        platform: "ANDROID",
        userId: "u1",
        p256dh: null,
        auth: null,
      });
      expect(db.rows[0].lastSeenAt).toBeInstanceOf(Date);
    });

    it("stores the subscription keys on a WEB row", async () => {
      const { db, service } = await makeService();

      await service.registerDevice(USER, {
        platform: "WEB",
        pushToken: ENDPOINT,
        ...WEB_KEYS,
      });

      expect(db.rows[0]).toMatchObject({
        platform: "WEB",
        pushToken: ENDPOINT,
        p256dh: "p256dh-key",
        auth: "auth-secret",
        userId: "u1",
      });
    });

    it("rejects a WEB endpoint that is not a browser push service", async () => {
      const { db, service } = await makeService();

      await expect(
        service.registerDevice(USER, {
          platform: "WEB",
          pushToken: "https://attacker.example.test/hook",
          ...WEB_KEYS,
        }),
      ).rejects.toThrow("browser push service endpoint");
      expect(db.rows).toHaveLength(0);
    });

    it("rejects a browser push host on a non-default port or with credentials", async () => {
      const { service } = await makeService();

      for (const pushToken of [
        "https://fcm.googleapis.com:8443/wpush/x",
        "https://user:pw@fcm.googleapis.com/wpush/x",
      ]) {
        await expect(
          service.registerDevice(USER, {
            platform: "WEB",
            pushToken,
            ...WEB_KEYS,
          }),
        ).rejects.toThrow("browser push service endpoint");
      }
    });

    it("refreshes the keys when a WEB subscription re-registers", async () => {
      const { db, service } = await makeService([
        {
          id: "d1",
          platform: "WEB",
          pushToken: ENDPOINT,
          p256dh: "old",
          auth: "old",
          userId: "u1",
          lastSeenAt: null,
        },
      ]);

      await service.registerDevice(USER, {
        platform: "WEB",
        pushToken: ENDPOINT,
        ...WEB_KEYS,
      });

      expect(db.rows).toHaveLength(1);
      expect(db.rows[0]).toMatchObject({
        p256dh: "p256dh-key",
        auth: "auth-secret",
      });
    });

    it("drops keys sent with a native platform", async () => {
      const { db, service } = await makeService();

      await service.registerDevice(USER, {
        platform: "IOS",
        pushToken: "tok-i",
        ...WEB_KEYS,
      });

      expect(db.rows[0]).toMatchObject({ p256dh: null, auth: null });
    });

    it("rejects a WEB endpoint that is not https", async () => {
      const { db, service } = await makeService();

      await expect(
        service.registerDevice(USER, {
          platform: "WEB",
          pushToken: "http://push.example.test/abc",
          ...WEB_KEYS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.registerDevice(USER, {
          platform: "WEB",
          pushToken: "not a url",
          ...WEB_KEYS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.rows).toHaveLength(0);
    });

    it("re-homes an existing token to the caller instead of duplicating", async () => {
      const { db, service } = await makeService([
        {
          id: "d1",
          platform: "IOS",
          pushToken: "tok-shared",
          p256dh: null,
          auth: null,
          userId: "someone-else",
          lastSeenAt: null,
        },
      ]);

      const { id } = await service.registerDevice(USER, {
        platform: "ANDROID",
        pushToken: "tok-shared",
        p256dh: null,
        auth: null,
      });

      expect(id).toBe("d1");
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0]).toMatchObject({
        userId: "u1",
        platform: "ANDROID",
      });
      expect(db.rows[0].lastSeenAt).toBeInstanceOf(Date);
    });
  });

  describe("unregisterDevice", () => {
    it("removes the caller's row and echoes the token", async () => {
      const { db, service } = await makeService([
        {
          id: "d1",
          platform: "ANDROID",
          pushToken: "tok-a",
          p256dh: null,
          auth: null,
          userId: "u1",
          lastSeenAt: null,
        },
      ]);

      await expect(service.unregisterDevice(USER, "tok-a")).resolves.toEqual({
        pushToken: "tok-a",
      });
      expect(db.rows).toHaveLength(0);
    });

    it("is a no-op for another user's token, leaving it in place", async () => {
      const { db, service } = await makeService([
        {
          id: "d1",
          platform: "ANDROID",
          pushToken: "tok-a",
          p256dh: null,
          auth: null,
          userId: "someone-else",
          lastSeenAt: null,
        },
      ]);

      await expect(service.unregisterDevice(USER, "tok-a")).resolves.toEqual({
        pushToken: "tok-a",
      });
      expect(db.rows).toHaveLength(1);
    });

    it("is a no-op (not an error) for an unknown token", async () => {
      const { service } = await makeService([]);

      await expect(service.unregisterDevice(USER, "nope")).resolves.toEqual({
        pushToken: "nope",
      });
    });
  });
});
