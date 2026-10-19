import { Controller, Get, UseGuards } from "@nestjs/common";
import type { SpiritsResponse } from "@zenflow/shared";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { SpiritsService } from "./spirits.service";

@Controller("spirits")
@UseGuards(CookieAuthGuard)
export class SpiritsController {
  constructor(private readonly spirits: SpiritsService) {}

  @Get()
  async get(@CurrentUser() user: User) {
    const data: SpiritsResponse = await this.spirits.overview(user);
    return { success: true, message: "Spirits", data };
  }
}
