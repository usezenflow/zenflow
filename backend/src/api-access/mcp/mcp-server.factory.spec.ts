import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
      "get_session",
      "list_schedule",
    ]);
    await client.close();
    await server.close();
  });
});
