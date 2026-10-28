import { Module } from "@nestjs/common";
import { PublicUrls } from "../common/config/public-urls";
import { OAuthConfig } from "../oauth/oauth.config";
import { PrismaModule } from "../prisma/prisma.module";
import { ApiTokenGuard } from "./api-token.guard";
import { ApiTokensService } from "./api-tokens.service";

/** Token storage and the guard. Import it wherever a route takes a bearer token. */
@Module({
  imports: [PrismaModule],
  providers: [ApiTokensService, ApiTokenGuard, OAuthConfig, PublicUrls],
  exports: [ApiTokensService, ApiTokenGuard, OAuthConfig],
})
export class ApiTokensModule {}
