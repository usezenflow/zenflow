/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { WebPushSender } from "./web-push.sender";
import type { PushMessage, WebPushTarget } from "./types";

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const VAPID = {
  VAPID_PUBLIC_KEY: "BPub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:ops@example.test",
};

const MSG: PushMessage = {
  title: "New exam: Môn học Mẫu Một",
  body: "Added to your calendar from DLU.",
  data: {
    notificationId: "n1",
    eventName: "exam.created",
    sessionId: "s1",
    slotProposalId: "",
    url: "/calendar?session=s1",
  },
  tone: "default",
};

const TARGET: WebPushTarget = {
  endpoint: "https://push.example.test/a",
  p256dh: "p256",
  auth: "auth",
};

async function make(env: Record<string, string | undefined>) {
  const config = { get: jest.fn((key: string) => env[key]) };
  const module: TestingModule = await Test.createTestingModule({
    providers: [WebPushSender, { provide: ConfigService, useValue: config }],
  }).compile();
  return module.get<WebPushSender>(WebPushSender);
}

/** A web-push error shaped like the library's `WebPushError`. */
function pushError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`status ${statusCode}`), { statusCode });
}

describe("WebPushSender", () => {
  afterEach(() => jest.clearAllMocks());

  describe("configuration", () => {
    it("is disabled without VAPID_*: no VAPID setup, no key, sends nothing", async () => {
      const sender = await make({});

      expect(sender.enabled).toBe(false);
      expect(sender.publicKey).toBeNull();
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
      await expect(sender.send([TARGET], MSG)).resolves.toEqual({
        sent: 0,
        invalidTokens: [],
      });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it("is disabled when any one VAPID var is missing", async () => {
      const sender = await make({ ...VAPID, VAPID_SUBJECT: undefined });

      expect(sender.enabled).toBe(false);
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    });

    it("is disabled when the VAPID keys are rejected", async () => {
      (webpush.setVapidDetails as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Vapid public key must be a URL safe Base 64");
      });

      const sender = await make(VAPID);

      expect(sender.enabled).toBe(false);
      expect(sender.publicKey).toBeNull();
    });

    it("is enabled with all three vars: registers the VAPID details and exposes the public key", async () => {
      const sender = await make(VAPID);

      expect(sender.enabled).toBe(true);
      expect(sender.publicKey).toBe("BPub");
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        "mailto:ops@example.test",
        "BPub",
        "priv",
      );
    });
  });

  describe("send", () => {
    it("sends the subscription, a JSON payload with routing data and normal urgency", async () => {
      (webpush.sendNotification as jest.Mock).mockResolvedValue({});
      const sender = await make(VAPID);

      const res = await sender.send([TARGET], MSG);

      expect(res).toEqual({ sent: 1, invalidTokens: [] });
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        {
          endpoint: "https://push.example.test/a",
          keys: { p256dh: "p256", auth: "auth" },
        },
        expect.any(String),
        expect.objectContaining({ TTL: expect.any(Number), urgency: "normal" }),
      );
      const payload = JSON.parse(
        (webpush.sendNotification as jest.Mock).mock.calls[0][1] as string,
      ) as unknown;
      expect(payload).toEqual({
        title: MSG.title,
        body: MSG.body,
        tone: "default",
        category: null,
        actions: [],
        data: {
          notificationId: "n1",
          eventName: "exam.created",
          sessionId: "s1",
          slotProposalId: "",
          url: "/calendar?session=s1",
        },
      });
    });

    it("carries the session-end category and both action ids", async () => {
      (webpush.sendNotification as jest.Mock).mockResolvedValue({});
      const sender = await make(VAPID);

      await sender.send([TARGET], {
        ...MSG,
        category: "session_end",
        actions: ["done", "not_this_time"],
      });

      const [, body] = (webpush.sendNotification as jest.Mock).mock
        .calls[0] as [unknown, string];
      expect(JSON.parse(body) as unknown).toMatchObject({
        category: "session_end",
        actions: ["done", "not_this_time"],
      });
    });

    it("carries the action category and the proposal id for plan offers", async () => {
      (webpush.sendNotification as jest.Mock).mockResolvedValue({});
      const sender = await make(VAPID);

      await sender.send([TARGET], {
        ...MSG,
        tone: "urgent",
        category: "plan_offer",
        data: { ...MSG.data, slotProposalId: "p1" },
        extra: { checkInId: "c1" },
      });

      const [, body, options] = (webpush.sendNotification as jest.Mock).mock
        .calls[0] as [unknown, string, { urgency: string }];
      expect(options.urgency).toBe("high");
      expect(JSON.parse(body) as unknown).toMatchObject({
        tone: "urgent",
        category: "plan_offer",
        data: { slotProposalId: "p1", checkInId: "c1" },
      });
    });

    it("prunes endpoints the push service reports gone (404 and 410)", async () => {
      (webpush.sendNotification as jest.Mock)
        .mockRejectedValueOnce(pushError(404))
        .mockRejectedValueOnce(pushError(410))
        .mockResolvedValueOnce({});
      const sender = await make(VAPID);
      const targets = [
        { ...TARGET, endpoint: "https://push.example.test/gone-404" },
        { ...TARGET, endpoint: "https://push.example.test/gone-410" },
        { ...TARGET, endpoint: "https://push.example.test/ok" },
      ];

      await expect(sender.send(targets, MSG)).resolves.toEqual({
        sent: 1,
        invalidTokens: [
          "https://push.example.test/gone-404",
          "https://push.example.test/gone-410",
        ],
      });
    });

    it("keeps transient failures (5xx, network) out of the prune list", async () => {
      (webpush.sendNotification as jest.Mock)
        .mockRejectedValueOnce(pushError(500))
        .mockRejectedValueOnce(new Error("socket hang up"));
      const sender = await make(VAPID);

      await expect(sender.send([TARGET, TARGET], MSG)).resolves.toEqual({
        sent: 0,
        invalidTokens: [],
      });
    });

    it("sends nothing for an empty target list", async () => {
      const sender = await make(VAPID);

      await expect(sender.send([], MSG)).resolves.toEqual({
        sent: 0,
        invalidTokens: [],
      });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
  });
});
