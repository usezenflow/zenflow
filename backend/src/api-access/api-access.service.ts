import { Injectable } from "@nestjs/common";
import type { ApiAccessResponse } from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { buildApiAccessPrompt } from "./api-access-prompt";
import { buildAssistantSetup } from "./assistant-setup";

@Injectable()
export class ApiAccessService {
  /** `apiBase` is the public REST base, e.g. `https://host/api/v1`. */
  summary(user: User, apiBase: string): ApiAccessResponse {
    const mcpUrl = `${apiBase}/mcp`;
    return {
      mcpUrl,
      restBaseUrl: apiBase,
      prompt: buildApiAccessPrompt({
        timezone: user.timezone,
        lang: user.lang,
      }),
      setup: buildAssistantSetup({ mcpUrl }),
    };
  }
}
