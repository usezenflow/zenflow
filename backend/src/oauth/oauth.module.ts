import { Module } from "@nestjs/common";
import { PublicUrls } from "../common/config/public-urls";
import { PrismaModule } from "../prisma/prisma.module";
import { OAuthCleanupService } from "./oauth-cleanup.service";
import { OAuthConsentService } from "./oauth-consent.service";
import { OAuthConnectController } from "./oauth-connect.controller";
import { OAuthController } from "./oauth.controller";
import { OAuthConfig } from "./oauth.config";
import { OAuthProvider } from "./oauth.provider";
import { OAuthRouter } from "./oauth-router";

const CORE = [PublicUrls, OAuthConfig, OAuthProvider];

/** The authorization server for MCP clients, the code page and the approval endpoints. */
@Module({
  imports: [PrismaModule],
  controllers: [OAuthController, OAuthConnectController],
  providers: [...CORE, OAuthConsentService, OAuthRouter],
  exports: [OAuthConfig, OAuthRouter],
})
export class OAuthModule {}

/** Cron that purges expired tokens; registered on the watcher only. */
@Module({ imports: [PrismaModule], providers: [OAuthCleanupService] })
export class OAuthCleanupModule {}
