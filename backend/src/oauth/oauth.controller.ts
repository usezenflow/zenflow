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
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { ConsentDecisionDto } from "./consent-decision.dto";
import { OAuthConsentService } from "./oauth-consent.service";

/** The signed-in side of OAuth: the consent screen and the list of connected assistants. */
@Controller("oauth")
@UseGuards(CookieAuthGuard)
export class OAuthController {
  constructor(private readonly consent: OAuthConsentService) {}

  @Get("consent")
  async describe(@CurrentUser() user: User, @Query("request") request = "") {
    return {
      success: true,
      message: "Authorization request",
      data: await this.consent.describe(user, request),
    };
  }

  @Post("consent")
  async decide(@CurrentUser() user: User, @Body() dto: ConsentDecisionDto) {
    return {
      success: true,
      message: "Decision recorded",
      data: await this.consent.decide(user, dto.request, dto.approve),
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
