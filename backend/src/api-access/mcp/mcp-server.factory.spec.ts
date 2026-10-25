import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConflictException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../../generated/prisma";
import { SessionsService } from "../../sessions/sessions.service";
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
      providers: [McpServerFactory, { provide: SessionsService, useValue: {} }],
    }).compile();
    factory = module.get(McpServerFactory);
  });

  it("builds a server that completes the MCP handshake over an in-memory transport", async () => {
    const { server, client } = await connect(factory);

    expect(client.getServerVersion()).toEqual({
      name: "zenflow",
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
      "get_session",
      "list_schedule",
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
  };

  async function connected() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpServerFactory,
        { provide: SessionsService, useValue: sessions },
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

  it("update_session moves a session as the signed-in user", async () => {
    sessions.update.mockResolvedValue({
      id: "s1",
      scheduledStartTime: "2026-11-05T11:00:00.000Z",
    });
    const { client } = await connected();

    const res = await call(client, "update_session", {
      id: "s1",
      scheduledStartTime: "2026-11-05T11:00:00.000Z",
      durationMinutes: 90,
    });

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

    const res = await call(client, "update_session", {
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

    const res = await call(client, "update_session", {
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

    const res = await call(client, "delete_sessions", {
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

    const res = await call(client, "delete_sessions", {
      items: [{ kind: "everything", id: "x" }],
    });

    expect(res.isError).toBe(true);
    expect(sessions.bulkDelete).not.toHaveBeenCalled();
  });
});
