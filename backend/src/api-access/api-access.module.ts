import { Module } from "@nestjs/common";
import { ApiAccessController } from "./api-access.controller";
import { ApiAccessService } from "./api-access.service";
import { ApiTokensModule } from "./api-tokens.module";
import { SessionsModule } from "../sessions/sessions.module";
import { McpController } from "./mcp/mcp.controller";
import { McpServerFactory } from "./mcp/mcp-server.factory";

@Module({
  imports: [ApiTokensModule, SessionsModule],
  controllers: [ApiAccessController, McpController],
  providers: [ApiAccessService, McpServerFactory],
})
export class ApiAccessModule {}
