import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomUUID } from "crypto";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { NtfySender } from "../src/devices/ntfy.sender";
import { PushProviderError, PushService } from "../src/devices/push.service";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Push delivery against the real database and a stubbed ntfy endpoint (a local
 * HTTP server): who a notification is sent to, what is published, what is
 * pruned and when the queue job must retry. `PushService`, `NtfySender`,
 * Prisma and Postgres are real.
 */
jest.setTimeout(60_000);

interface Published {
  topic: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let ntfy: Server;
let published: Published[];
/** Status the stub answers per topic; 200 when absent. */
let statusOf: Map<string, number>;

let prisma: PrismaService;
let push: PushService;
let closeModule: () => Promise<void>;

beforeAll(async () => {
  ntfy = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      const topic = (req.url ?? "").slice(1);
      published.push({ topic, headers: req.headers, body });
      res.statusCode = statusOf.get(topic) ?? 200;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => ntfy.listen(0, "127.0.0.1", r));
  const { port } = ntfy.address() as AddressInfo;

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            NTFY_BASE_URL: `http://127.0.0.1:${port}`,
            NTFY_TOKEN: "tk_test",
          }),
        ],
      }),
    ],
    providers: [PushService, PrismaService, NtfySender],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  push = moduleRef.get(PushService);
  closeModule = () => moduleRef.close();
});
afterAll(async () => {
  // Cascades to devices, notifications and sessions.
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await closeModule();
  await new Promise((r) => ntfy.close(r));
});
beforeEach(() => {
  published = [];
  statusOf = new Map();
});

const createdUsers: string[] = [];

async function user(
  over: { allowNotifications?: boolean; lang?: "EN_US" | "VI_VN" } = {},
) {
  const created = await prisma.user.create({
    data: {
      name: "Push Student",
      email: `push-${randomUUID()}@example.test`,
      allowNotifications: over.allowNotifications ?? true,
      lang: over.lang ?? "EN_US",
    },
  });
  createdUsers.push(created.id);
  return created;
}
const device = (
  userId: string,
  platform: "ANDROID" | "IOS" = "ANDROID",
  token: string = randomUUID(),
) => prisma.userDevice.create({ data: { userId, platform, pushToken: token } });
const note = (userId: string, over: Record<string, unknown> = {}) =>
  prisma.notification.create({
    data: {
      userId,
      eventName: "assignment.created",
      title: "New assignment: Graph theory report",
      content: "Added from your LMS. Plan the work that leads up to it.",
      sessionId: null,
      ...over,
    },
  });
const tokensOf = (userId: string) =>
  prisma.userDevice
    .findMany({ where: { userId } })
    .then((rows) => rows.map((r) => r.pushToken).sort());

describe("routing", () => {
  it("publishes to every device topic of the student, with the notification's details", async () => {
    const u = await user();
    const a = await device(u.id, "ANDROID");
    const i = await device(u.id, "IOS");
    await push.sendToUser(u.id, await note(u.id));
    expect(published.map((p) => p.topic).sort()).toEqual(
      [a.pushToken, i.pushToken].sort(),
    );
    expect(published[0]).toMatchObject({
      body: "Added from your LMS. Plan the work that leads up to it.",
      headers: {
        title: "New assignment: Graph theory report",
        authorization: "Bearer tk_test",
        priority: "default",
        click: "zenflow://notifications",
        tags: "assignment.created",
      },
    });
  });

  it("links a notification about a session to that session on the calendar", async () => {
    const u = await user();
    await device(u.id);
    const session = await prisma.session.create({
      data: {
        userId: u.id,
        title: "Lab",
        type: "LECTURE",
        durationMinutes: 60,
        scheduledStartTime: new Date(Date.now() + 86_400_000),
      },
    });
    await push.sendToUser(u.id, await note(u.id, { sessionId: session.id }));
    expect(published[0].headers.click).toBe(
      `zenflow://calendar?session=${session.id}`,
    );
  });

  it("marks a sync conflict high priority", async () => {
    const u = await user();
    await device(u.id);
    await push.sendToUser(
      u.id,
      await note(u.id, { eventName: "sync_conflict.lecture" }),
    );
    expect(published[0].headers.priority).toBe("high");
  });

  it("never sends one student's notification to another student's device", async () => {
    const a = await user();
    const b = await user();
    await device(a.id);
    const bToken = (await device(b.id)).pushToken;
    await push.sendToUser(a.id, await note(a.id));
    expect(published.map((p) => p.topic)).not.toContain(bToken);
  });
});

describe("when not to send", () => {
  it("sends nothing to a student who turned notifications off", async () => {
    const u = await user({ allowNotifications: false });
    await device(u.id);
    await push.sendToUser(u.id, await note(u.id));
    expect(published).toHaveLength(0);
  });

  it("is a quiet no-op for a student with no devices", async () => {
    const u = await user();
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).resolves.toBeUndefined();
    expect(published).toHaveLength(0);
  });
});

describe("the message", () => {
  it("is in the student's language, encoded for the header", async () => {
    const u = await user({ lang: "VI_VN" });
    await device(u.id);
    await push.sendToUser(u.id, await note(u.id));
    const title = published[0].headers.title as string;
    const b64 = /^=\?UTF-8\?B\?(.+)\?=$/.exec(title)?.[1] ?? "";
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(
      "Bài tập mới: Graph theory report",
    );
  });
});

describe("invalid topics and failures", () => {
  it("deletes a malformed topic without publishing to it and keeps the rest", async () => {
    const u = await user();
    await device(u.id, "ANDROID", "legacy:fcm/token");
    const live = await device(u.id);
    await push.sendToUser(u.id, await note(u.id));
    expect(await tokensOf(u.id)).toEqual([live.pushToken]);
    expect(published.map((p) => p.topic)).toEqual([live.pushToken]);
  });

  it("treats a partial success as delivered", async () => {
    const u = await user();
    const bad = await device(u.id);
    await device(u.id);
    statusOf.set(bad.pushToken, 503);
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).resolves.toBeUndefined();
    expect(await tokensOf(u.id)).toHaveLength(2);
  });

  it("fails the job when ntfy took nothing, so the queue retries it", async () => {
    const u = await user();
    const d = await device(u.id);
    statusOf.set(d.pushToken, 503);
    await expect(
      push.sendToUser(u.id, await note(u.id)),
    ).rejects.toBeInstanceOf(PushProviderError);
  });

  it("fails the job for a notification that doesn't exist (yet), so the retry finds it", async () => {
    await expect(push.deliver(randomUUID(), {})).rejects.toThrow(/not found/);
  });
});
