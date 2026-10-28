import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RateLimit } from "@limitkit/nest";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { ConsentDecisionDto } from "./consent-decision.dto";
import { OAuthConsentService } from "./oauth-consent.service";
import { consentRules } from "./oauth-rate-limit";

/** The signed-in side of OAuth: approving an assistant by its code, and the list of connected assistants. */
@Controller("oauth")
@UseGuards(CookieAuthGuard)
export class OAuthController {
  constructor(private readonly consent: OAuthConsentService) {}

  @RateLimit({ rules: consentRules })
  @Get("consent")
  async describe(@CurrentUser() user: User, @Query("code") code = "") {
    return {
      success: true,
      message: "Authorization request",
      data: await this.consent.describe(user, code),
    };
  }

  @RateLimit({ rules: consentRules })
  @Post("consent")
  async decide(@CurrentUser() user: User, @Body() dto: ConsentDecisionDto) {
    return {
      success: true,
      message: "Decision recorded",
      data: await this.consent.decide(user, dto.code, dto.approve),
    };
  }

  @Get("apps")
  async apps(@CurrentUser() user: User) {
    return {
      success: true,
      message: "Connected assistants",
      data: await this.consent.apps(user),
    };
  }

  @Delete("apps/:clientId")
  async revoke(@CurrentUser() user: User, @Param("clientId") clientId: string) {
    return {
      success: true,
      message: "Assistant disconnected",
      data: await this.consent.revokeApp(user, clientId),
    };
  }
}
