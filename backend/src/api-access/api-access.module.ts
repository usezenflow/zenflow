import { Module } from "@nestjs/common";
import { PublicUrls } from "../common/config/public-urls";
import { ApiAccessController } from "./api-access.controller";
import { ApiAccessService } from "./api-access.service";
import { ApiTokensModule } from "./api-tokens.module";
import { SessionsModule } from "../sessions/sessions.module";
import { GoogleCalendarModule } from "../google-calendar/google-calendar.module";
import { McpController } from "./mcp/mcp.controller";
import { McpServerFactory } from "./mcp/mcp-server.factory";

@Module({
  imports: [ApiTokensModule, SessionsModule, GoogleCalendarModule],
  controllers: [ApiAccessController, McpController],
  providers: [ApiAccessService, McpServerFactory, PublicUrls],
})
export class ApiAccessModule {}
