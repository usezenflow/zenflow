import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "../../../generated/prisma";
import { GoogleCalendarService } from "../../google-calendar/google-calendar.service";
import { PlacementPlanService } from "../../sessions/placement-plan.service";
import { SessionsService } from "../../sessions/sessions.service";
import { registerSessionTools } from "./mcp-session-tools";

/** A fresh MCP server per request, bound to the token's user: the endpoint is stateless. */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly sessions: SessionsService,
    private readonly placement: PlacementPlanService,
    private readonly calendar: GoogleCalendarService,
  ) {}

  create(user: User): McpServer {
    const server = new McpServer({ name: "zenflow", version: "1.0.0" });
    registerSessionTools(
      server,
      {
        sessions: this.sessions,
        placement: this.placement,
        calendar: this.calendar,
      },
      user,
    );
    return server;
  }
}
