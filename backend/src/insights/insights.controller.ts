import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { InsightsQueryDto } from "./dto/insights-query.dto";
import { InsightsService } from "./insights.service";

@Controller("users/me/insights")
@UseGuards(CookieAuthGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /**
   * Focus map (DONE events by weekday and hour), weekly recap and exam or
   * assignment buffers for the caller. `from` and `to` are inclusive
   * `YYYY-MM-DD` dates in the user's timezone; the window is at most 92 days.
   */
  @Get()
  async get(@Query() query: InsightsQueryDto, @CurrentUser() user: User) {
    return { success: true, data: await this.insights.summarize(user, query) };
  }
}
