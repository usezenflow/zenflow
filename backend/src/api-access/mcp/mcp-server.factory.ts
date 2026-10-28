import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { User } from "../../../generated/prisma";
import { PlacementPlanService } from "../../sessions/placement-plan.service";
import { ReplanService } from "../../sessions/replan.service";
import { SessionsService } from "../../sessions/sessions.service";
import { buildApiAccessPrompt } from "../api-access-prompt";
import { PublicUrls } from "../../common/config/public-urls";
import { LOGO_DATA_URI } from "../../common/brand";
import { readVersionedSecret } from "../../common/config/versioned-secret";
import { PlanTokens } from "./plan-token";
import { registerSessionTools } from "./mcp-session-tools";

/** A fresh MCP server per request, bound to the token's user: the endpoint is stateless. */
@Injectable()
export class McpServerFactory {
  private readonly plans: PlanTokens;

  constructor(
    private readonly sessions: SessionsService,
    private readonly placement: PlacementPlanService,
    private readonly replans: ReplanService,
    @Optional() config?: ConfigService,
    @Optional() private readonly urls?: PublicUrls,
  ) {
    const pepper = config
      ? readVersionedSecret((k) => config.get<string>(k), "API_TOKEN_PEPPER")
      : undefined;
    this.plans = new PlanTokens(pepper?.values.get(pepper.current));
  }

  create(user: User): McpServer {
    const web = this.urls?.web;
    const server = new McpServer(
      {
        name: "zenflow",
        title: "Zenflow",
        version: "1.0.0",
        // Clients show this where a connector has no icon of its own.
        icons: [
          { src: LOGO_DATA_URI, mimeType: "image/svg+xml", sizes: ["any"] },
        ],
        ...(web ? { websiteUrl: web } : {}),
      },
      {
        instructions: buildApiAccessPrompt({
          timezone: user.timezone,
          lang: user.lang,
        }),
      },
    );
    registerSessionTools(
      server,
      {
        sessions: this.sessions,
        placement: this.placement,
        replans: this.replans,
        plans: this.plans,
      },
      user,
    );
    return server;
  }
}
