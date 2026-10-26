import { Test, TestingModule } from "@nestjs/testing";
import { type Notification } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { NtfySender } from "./ntfy.sender";
import {
  PushProviderError,
  PushService,
  type ProviderGuard,
} from "./push.service";
import type { SendResult } from "./types";

interface DeviceRow {
  platform: "IOS" | "ANDROID";
  pushToken: string;
  userId: string;
}

function makePrismaDouble(devices: DeviceRow[], allowNotifications = true) {
  const client = {
    user: {
      findUnique: jest.fn(() => Promise.resolve({ allowNotifications })),
    },
    userDevice: {
      findMany: jest.fn((args: { where: { userId: string } }) =>
        Promise.resolve(devices.filter((d) => d.userId === args.where.userId)),
      ),
      deleteMany: jest.fn(
        (args: { where: { pushToken: { in: string[] } } }) => {
          const before = devices.length;
          for (let i = devices.length - 1; i >= 0; i--) {
            if (args.where.pushToken.in.includes(devices[i].pushToken)) {
              devices.splice(i, 1);
            }
          }
          return Promise.resolve({ count: before - devices.length });
        },
      ),
    },
  };
  return { client, devices };
}

function fakeSender(
  enabled: boolean,
  result: SendResult = { sent: 1, invalidTokens: [] },
) {
  return {
    enabled,
    send: jest.fn().mockResolvedValue(result),
  };
}

const ROW = {
  id: "n1",
  userId: "u1",
  title: "New exam: Môn học Mẫu Một",
  content: "Added to your calendar from DLU.",
  eventName: "exam.created",
  sessionId: "s1",
} as unknown as Notification;

const DEVICE: DeviceRow = {
  platform: "ANDROID",
  pushToken: "topic-aaaaaaaaaaaaaaaa",
  userId: "u1",
};

async function make(opts: {
  devices?: DeviceRow[];
  ntfy?: ReturnType<typeof fakeSender>;
  allowNotifications?: boolean;
}) {
  const db = makePrismaDouble(opts.devices ?? [], opts.allowNotifications);
  const ntfy = opts.ntfy ?? fakeSender(true);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PushService,
      { provide: PrismaService, useValue: db.client },
      { provide: NtfySender, useValue: ntfy },
    ],
  }).compile();
  const service = module.get<PushService>(PushService);

  return { db, service, ntfy };
}

describe("PushService", () => {
  describe("sendToUser", () => {
    it("is a no-op when ntfy is disabled", async () => {
      const { service, db, ntfy } = await make({
        devices: [DEVICE],
        ntfy: fakeSender(false),
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.findMany).not.toHaveBeenCalled();
      expect(ntfy.send).not.toHaveBeenCalled();
    });

    it("skips push when the user has allowNotifications=false", async () => {
      const { service, db, ntfy } = await make({
        devices: [DEVICE],
        allowNotifications: false,
      });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.findMany).not.toHaveBeenCalled();
      expect(ntfy.send).not.toHaveBeenCalled();
    });

    it("does nothing when the user has no devices", async () => {
      const { service, ntfy } = await make({ devices: [] });

      await service.sendToUser("u1", ROW);

      expect(ntfy.send).not.toHaveBeenCalled();
    });

    it("sends every device topic of the user, with title/body/data", async () => {
      const { service, ntfy } = await make({
        devices: [
          DEVICE,
          { ...DEVICE, platform: "IOS", pushToken: "topic-bbbbbbbbbbbbbbbb" },
          { ...DEVICE, pushToken: "topic-other-user-00", userId: "u2" },
        ],
      });

      await service.sendToUser("u1", ROW);

      expect(ntfy.send).toHaveBeenCalledWith(
        ["topic-aaaaaaaaaaaaaaaa", "topic-bbbbbbbbbbbbbbbb"],
        {
          title: ROW.title,
          body: ROW.content,
          data: {
            notificationId: "n1",
            eventName: "exam.created",
            sessionId: "s1",
            slotProposalId: "",
            url: "/calendar?session=s1",
          },
          tone: "default",
        },
      );
    });

    it("uses the urgent tone for a sync conflict", async () => {
      const { service, ntfy } = await make({ devices: [DEVICE] });

      await service.sendToUser("u1", {
        ...ROW,
        eventName: "sync_conflict.lecture",
        sessionId: null,
      });

      expect(ntfy.send).toHaveBeenCalledWith(
        [DEVICE.pushToken],
        expect.objectContaining({ tone: "urgent" }),
      );
    });

    it("uses the /notifications url when the row has no session", async () => {
      const { service, ntfy } = await make({ devices: [DEVICE] });

      await service.sendToUser("u1", { ...ROW, sessionId: null });

      expect(ntfy.send).toHaveBeenCalledWith(
        [DEVICE.pushToken],
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: "",
            url: "/notifications",
          }) as unknown,
        }),
      );
    });

    it("prunes the topics the sender reports invalid", async () => {
      const { service, db } = await make({
        devices: [DEVICE, { ...DEVICE, pushToken: "bad:token" }],
        ntfy: fakeSender(true, { sent: 1, invalidTokens: ["bad:token"] }),
      });

      await service.sendToUser("u1", ROW);

      expect(db.devices.map((d) => d.pushToken)).toEqual([DEVICE.pushToken]);
    });

    it("does not call deleteMany when nothing is invalid", async () => {
      const { service, db } = await make({ devices: [DEVICE] });

      await service.sendToUser("u1", ROW);

      expect(db.client.userDevice.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    it("runs the send through the guard as ntfy", async () => {
      const { service } = await make({ devices: [DEVICE] });
      const calls: string[] = [];
      const guard: ProviderGuard = (p, fn) => {
        calls.push(p);
        return fn();
      };

      await service.sendToUser("u1", ROW, { guard });

      expect(calls).toEqual(["ntfy"]);
    });

    it("throws PushProviderError when every send failed transiently, so the job retries", async () => {
      const { service } = await make({
        devices: [DEVICE],
        ntfy: fakeSender(true, { sent: 0, invalidTokens: [] }),
      });

      await expect(service.sendToUser("u1", ROW)).rejects.toBeInstanceOf(
        PushProviderError,
      );
    });

    it("treats all-invalid topics as handled (pruned, no retry)", async () => {
      const { service, db } = await make({
        devices: [DEVICE],
        ntfy: fakeSender(true, {
          sent: 0,
          invalidTokens: [DEVICE.pushToken],
        }),
      });

      await expect(service.sendToUser("u1", ROW)).resolves.toBeUndefined();
      expect(db.devices).toHaveLength(0);
    });

    it("propagates a guard rejection (breaker open)", async () => {
      const { service, ntfy } = await make({ devices: [DEVICE] });
      const open = new Error("parked");
      const guard: ProviderGuard = () => Promise.reject(open);

      await expect(service.sendToUser("u1", ROW, { guard })).rejects.toBe(open);
      expect(ntfy.send).not.toHaveBeenCalled();
    });
  });

  describe("deliver", () => {
    it("loads the row by id and sends to its user", async () => {
      const { service, db } = await make({});
      (db.client as unknown as Record<string, unknown>).notification = {
        findUnique: jest.fn().mockResolvedValue(ROW),
      };
      const spy = jest
        .spyOn(service, "sendToUser")
        .mockResolvedValue(undefined);

      await service.deliver("n1", {});

      expect(spy).toHaveBeenCalledWith("u1", ROW, {});
    });

    it("throws when the row is missing so BullMQ retries", async () => {
      const { service, db } = await make({});
      (db.client as unknown as Record<string, unknown>).notification = {
        findUnique: jest.fn().mockResolvedValue(null),
      };

      await expect(service.deliver("gone", {})).rejects.toThrow(/not found/);
    });
  });
});
