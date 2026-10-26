import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { NtfySender } from "./ntfy.sender";
import type { PushMessage } from "./types";

const MSG: PushMessage = {
  title: "Lịch thi mới: Giải tích",
  body: "Added to your calendar.",
  tone: "urgent",
  data: {
    notificationId: "n1",
    eventName: "exam.created",
    sessionId: "s1",
    slotProposalId: "",
    url: "/calendar?session=s1",
  },
};
const TOPIC = "topic-aaaaaaaaaaaaaaaa";

async function make(env: Record<string, string>) {
  const module = await Test.createTestingModule({
    providers: [
      NtfySender,
      { provide: ConfigService, useValue: new ConfigService(env) },
    ],
  }).compile();
  return module.get(NtfySender);
}

describe("NtfySender", () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });
  afterEach(() => fetchSpy.mockRestore());

  it("is disabled without NTFY_BASE_URL and sends nothing", async () => {
    const sender = await make({});

    expect(sender.enabled).toBe(false);
    await expect(sender.send([TOPIC], MSG)).resolves.toEqual({
      sent: 0,
      invalidTokens: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the body to the topic with title, priority, click and tags", async () => {
    const sender = await make({ NTFY_BASE_URL: "https://ntfy.test/" });

    await expect(sender.send([TOPIC], MSG)).resolves.toEqual({
      sent: 1,
      invalidTokens: [],
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://ntfy.test/${TOPIC}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(MSG.body);
    const headers = init.headers as Record<string, string>;
    expect(headers.Priority).toBe("high");
    expect(headers.Click).toBe("zenflow://calendar?session=s1");
    expect(headers.Tags).toBe("exam.created");
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Title).toBe(
      `=?UTF-8?B?${Buffer.from(MSG.title).toString("base64")}?=`,
    );
  });

  it("sends the bearer token when configured", async () => {
    const sender = await make({
      NTFY_BASE_URL: "https://ntfy.test",
      NTFY_TOKEN: "tk_secret",
    });

    await sender.send([TOPIC], { ...MSG, title: "Plain", tone: "default" });

    const headers = (fetchSpy.mock.calls[0] as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tk_secret");
    expect(headers.Title).toBe("Plain");
    expect(headers.Priority).toBe("default");
  });

  it("reports malformed topics as invalid and does not publish to them", async () => {
    const sender = await make({ NTFY_BASE_URL: "https://ntfy.test" });

    const res = await sender.send(["fcm:token/../x", TOPIC], MSG);

    expect(res).toEqual({ sent: 1, invalidTokens: ["fcm:token/../x"] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("counts failed and thrown sends as not sent, never invalid", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("no", { status: 503 }))
      .mockRejectedValueOnce(new Error("down"));
    const sender = await make({ NTFY_BASE_URL: "https://ntfy.test" });

    await expect(
      sender.send([TOPIC, "topic-bbbbbbbbbbbbbbbb"], MSG),
    ).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });
});
