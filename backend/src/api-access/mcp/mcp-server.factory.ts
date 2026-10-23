import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "../../../generated/prisma";
import { SessionsService } from "../../sessions/sessions.service";
import { registerSessionTools } from "./mcp-session-tools";

/** A fresh MCP server per request, bound to the token's user: the endpoint is stateless. */
@Injectable()
export class McpServerFactory {
  constructor(private readonly sessions: SessionsService) {}

  create(user: User): McpServer {
    const server = new McpServer({ name: "zenflow", version: "1.0.0" });
    registerSessionTools(server, this.sessions, user);
    return server;
  }
}
