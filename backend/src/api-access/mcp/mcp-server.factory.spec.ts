import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConflictException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../../generated/prisma";
import { ReplanService } from "../../sessions/replan.service";
import { SessionsService } from "../../sessions/sessions.service";
import { PlacementPlanService } from "../../sessions/placement-plan.service";
import { GoogleCalendarService } from "../../google-calendar/google-calendar.service";
import { PublicUrls } from "../../common/config/public-urls";
import { McpServerFactory } from "./mcp-server.factory";

const USER = { id: "u1", timezone: "UTC" } as User;

async function connect(factory: McpServerFactory) {
  const server = factory.create(USER);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  return { server, client };
}

describe("McpServerFactory", () => {
  let factory: McpServerFactory;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpServerFactory,
        { provide: SessionsService, useValue: {} },
        { provide: PlacementPlanService, useValue: {} },
        { provide: GoogleCalendarService, useValue: {} },
        { provide: ReplanService, useValue: {} },
      ],
    }).compile();
    factory = module.get(McpServerFactory);
  });

  it("builds a server that completes the MCP handshake over an in-memory transport", async () => {
    const { server, client } = await connect(factory);

    expect(client.getServerVersion()).toEqual({
      name: "zenflow",
      title: "Zenflow",
      version: "1.0.0",
    });
    await client.close();
    await server.close();
  });

  it("lists the session tools", async () => {
    const { server, client } = await connect(factory);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_tasks",
      "delete_sessions",
      "find_free_slots",
      "get_session",
      "get_time",
      "list_schedule",
      "recap",
      "replan",
      "sync_status",
      "undo_last_change",
      "update_session",
    ]);
    await client.close();
    await server.close();
  });
});

describe("McpServerFactory write tools", () => {
  const sessions = {
    update: jest.fn(),
    bulkDelete: jest.fn(),
    findById: jest.fn(),
  };
  const placement = { undoLatest: jest.fn() };
  const calendar = { status: jest.fn() };

  async function connected() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpServerFactory,
        { provide: SessionsService, useValue: sessions },
        { provide: PlacementPlanService, useValue: placement },
        { provide: GoogleCalendarService, useValue: calendar },
        { provide: ReplanService, useValue: {} },
      ],
    }).compile();
    return connect(module.get(McpServerFactory));
  }

  beforeEach(() => jest.resetAllMocks());

  const call = (client: Client, name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }) as Promise<{
      isError?: boolean;
      content: { text: string }[];
    }>;

  /** Previews, then repeats the call with the planId, as an assistant must. */
  async function applied(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ) {
    const preview = await call(client, name, args);
    if (preview.isError) return preview;
    const { planId } = JSON.parse(preview.content[0].text) as {
      planId: string;
    };
    return call(client, name, { ...args, planId });
  }

  it("a write without a planId only previews", async () => {
    sessions.bulkDelete.mockResolvedValue({ dryRun: true, results: [] });
    const { client } = await connected();

    const res = await call(client, "delete_sessions", {
      items: [{ kind: "session", id: "s1" }],
    });

    expect(JSON.parse(res.content[0].text).planId).toEqual(expect.any(String));
    expect(sessions.bulkDelete).toHaveBeenCalledTimes(1);
    expect(sessions.bulkDelete).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      USER,
    );
  });

  it("a planId for other arguments is refused", async () => {
    sessions.bulkDelete.mockResolvedValue({ dryRun: true, results: [] });
    const { client } = await connected();
    const first = await call(client, "delete_sessions", {
      items: [{ kind: "session", id: "s1" }],
    });
    const { planId } = JSON.parse(first.content[0].text);

    const res = await call(client, "delete_sessions", {
      items: [{ kind: "session", id: "s2" }],
      planId,
    });

    expect(res.isError).toBe(true);
    expect(sessions.bulkDelete).toHaveBeenCalledTimes(1);
  });

  it("update_session moves a session as the signed-in user", async () => {
    sessions.update.mockResolvedValue({
      id: "s1",
      scheduledStartTime: "2026-11-05T11:00:00.000Z",
    });
    const { client } = await connected();

    const args = {
      id: "s1",
      scheduledStartTime: "2026-11-05T11:00:00.000Z",
      durationMinutes: 90,
    };
    sessions.findById.mockResolvedValue({ id: "s1" });
    const res = await applied(client, "update_session", args);

    expect(res.isError).toBeFalsy();
    expect(sessions.update).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        scheduledStartTime: "2026-11-05T11:00:00.000Z",
        durationMinutes: 90,
      }),
      USER,
    );
  });

  it("update_session rejects an off-grid duration before touching the service", async () => {
    const { client } = await connected();

    const res = await applied(client, "update_session", {
      id: "s1",
      durationMinutes: 50,
    });

    expect(res.isError).toBe(true);
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it("relays the REST error code and message", async () => {
    sessions.update.mockRejectedValue(
      new ConflictException({
        code: "SCHEDULE_INFEASIBLE",
        message: "No slot before the deadline",
      }),
    );
    const { client } = await connected();

    const res = await applied(client, "update_session", {
      id: "s1",
      title: "New",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(
      "SCHEDULE_INFEASIBLE: No slot before the deadline",
    );
  });

  it("delete_sessions deletes sessions, series and timetable groups in order", async () => {
    sessions.bulkDelete.mockResolvedValue({ dryRun: false, results: [] });
    const { client } = await connected();

    const res = await applied(client, "delete_sessions", {
      items: [
        { kind: "session", id: "s1" },
        { kind: "series", id: "ser1" },
        { kind: "timetable", id: "t1", scope: "following" },
      ],
    });

    expect(res.isError).toBeFalsy();
    expect(sessions.bulkDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ kind: "session", id: "s1" }),
          expect.objectContaining({ kind: "series", id: "ser1" }),
          expect.objectContaining({
            kind: "timetable",
            id: "t1",
            scope: "following",
          }),
        ],
      }),
      USER,
    );
  });

  it("delete_sessions rejects an unknown kind before touching the service", async () => {
    const { client } = await connected();

    const res = await applied(client, "delete_sessions", {
      items: [{ kind: "everything", id: "x" }],
    });

    expect(res.isError).toBe(true);
    expect(sessions.bulkDelete).not.toHaveBeenCalled();
  });
});

describe("McpServerFactory status and undo tools", () => {
  const placement = { undoLatest: jest.fn() };
  const calendar = { status: jest.fn() };

  async function connected() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpServerFactory,
        { provide: SessionsService, useValue: {} },
        { provide: PlacementPlanService, useValue: placement },
        { provide: GoogleCalendarService, useValue: calendar },
        { provide: ReplanService, useValue: {} },
      ],
    }).compile();
    return connect(module.get(McpServerFactory));
  }

  beforeEach(() => jest.resetAllMocks());

  it("sync_status returns the Google Calendar status of the signed-in user", async () => {
    calendar.status.mockResolvedValue({ connected: true, attempts: 0 });
    const { client } = await connected();

    const res = await client.callTool({ name: "sync_status", arguments: {} });

    expect(calendar.status).toHaveBeenCalledWith(USER);
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toEqual({
      connected: true,
      attempts: 0,
    });
  });

  it("undo_last_change reverts the newest undoable group", async () => {
    placement.undoLatest.mockResolvedValue({
      undoGroupId: "g1",
      restored: [],
      removedSessionIds: ["s1"],
      skippedSessionIds: [],
    });
    const { client } = await connected();

    const res = await client.callTool({
      name: "undo_last_change",
      arguments: {},
    });

    expect(placement.undoLatest).toHaveBeenCalledWith(USER);
    expect(res.isError).toBeFalsy();
  });

  it("undo_last_change reports a service error as a tool error", async () => {
    placement.undoLatest.mockRejectedValue(new Error("Nothing to undo"));
    const { client } = await connected();

    const res = await client.callTool({
      name: "undo_last_change",
      arguments: {},
    });

    expect(res.isError).toBe(true);
  });
});

describe("McpServerFactory branding", () => {
  it("advertises the logo and site when the web address is known", async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpServerFactory,
        { provide: SessionsService, useValue: {} },
        { provide: PlacementPlanService, useValue: {} },
        { provide: GoogleCalendarService, useValue: {} },
        { provide: ReplanService, useValue: {} },
        { provide: PublicUrls, useValue: { web: "https://app.test" } },
      ],
    }).compile();
    const { client } = await connect(module.get(McpServerFactory));

    expect(client.getServerVersion()).toMatchObject({
      websiteUrl: "https://app.test",
      icons: [
        { src: "https://app.test/pwa-512x512.png", mimeType: "image/png" },
      ],
    });
  });
});
