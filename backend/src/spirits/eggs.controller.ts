import { Controller, Param, Post, UseGuards } from "@nestjs/common";
import type { SpiritHatchResponse } from "@zenflow/shared";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { SpiritsService } from "./spirits.service";

@Controller("eggs")
@UseGuards(CookieAuthGuard)
export class EggsController {
  constructor(private readonly spirits: SpiritsService) {}

  @Post(":id/hatch")
  async hatch(@CurrentUser() user: User, @Param("id") id: string) {
    const data: SpiritHatchResponse = await this.spirits.hatch(user, id);
    return { success: true, message: "Hatched", data };
  }
}
