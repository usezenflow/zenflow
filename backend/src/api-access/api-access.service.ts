import { Injectable } from "@nestjs/common";
import type { ApiAccessResponse } from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { buildApiAccessPrompt } from "./api-access-prompt";
import { buildAssistantSetup } from "./assistant-setup";
import { ApiTokensService } from "./api-tokens.service";
import { MCP_TOOLS } from "./mcp/mcp-tool-catalog";

@Injectable()
export class ApiAccessService {
  constructor(private readonly tokens: ApiTokensService) {}

  /** `apiBase` is the public REST base, e.g. `https://host/api/v1`. */
  async summary(user: User, apiBase: string): Promise<ApiAccessResponse> {
    const mcpUrl = `${apiBase}/mcp`;
    return {
      mcpUrl,
      restBaseUrl: apiBase,
      prompt: buildApiAccessPrompt({
        timezone: user.timezone,
        tools: MCP_TOOLS,
      }),
      setup: buildAssistantSetup({ mcpUrl }),
      tokens: await this.tokens.list(user),
    };
  }
}
