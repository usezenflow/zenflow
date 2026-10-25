import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CookieAuthGuard } from "../auth/guards";
import { PublicUrls } from "../common/config/public-urls";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { ApiAccessService } from "./api-access.service";
import { ApiTokensService } from "./api-tokens.service";
import { CreateApiTokenDto } from "./dto/create-api-token.dto";

/** Management of personal API access. Cookie session only, never a bearer token. */
@Controller("users/me/api-access")
@UseGuards(CookieAuthGuard)
export class ApiAccessController {
  constructor(
    private readonly access: ApiAccessService,
    private readonly tokens: ApiTokensService,
    private readonly urls: PublicUrls,
  ) {}

  @Get()
  async get(@Req() req: Request, @CurrentUser() user: User) {
    const data = await this.access.summary(
      user,
      this.urls.api || apiBaseOf(req),
    );
    return { success: true, data };
  }

  @Post("tokens")
  async create(@Body() dto: CreateApiTokenDto, @CurrentUser() user: User) {
    const data = await this.tokens.create(user, dto);
    return { success: true, message: "API token created", data };
  }

  @Delete("tokens/:id")
  async revoke(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.tokens.revoke(user, id);
    return { success: true, message: "API token revoked", data };
  }
}

/** Fallback when `PUBLIC_API_URL` is unset: the request origin (trust proxy applies) plus the global prefix. */
function apiBaseOf(req: Request): string {
  return `${req.protocol}://${req.get("host")}/api/v1`;
}
