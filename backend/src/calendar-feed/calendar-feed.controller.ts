import {
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { type User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { CalendarFeedService } from "./calendar-feed.service";

/** Feed management. Cookie session only. */
@Controller("users/me/calendar-feed")
@UseGuards(CookieAuthGuard)
export class CalendarFeedManageController {
  constructor(private readonly feed: CalendarFeedService) {}

  @Get()
  async status(@CurrentUser() user: User) {
    const data = await this.feed.status(user);
    return { success: true, message: "Calendar feed", data };
  }

  @Post()
  async rotate(@CurrentUser() user: User) {
    const data = await this.feed.rotate(user);
    return { success: true, message: "Calendar feed link created", data };
  }

  @Delete()
  async revoke(@CurrentUser() user: User) {
    const data = await this.feed.revoke(user);
    return { success: true, message: "Calendar feed link removed", data };
  }
}

/** Public read-only feed. The secret in the path is the only credential. */
@Controller("calendar")
export class CalendarFeedController {
  constructor(private readonly feed: CalendarFeedService) {}

  @Get(":file")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Cache-Control", "private, max-age=900")
  async ics(@Param("file") file: string): Promise<string> {
    if (!file.endsWith(".ics")) throw new NotFoundException();
    const ics = await this.feed.render(file.slice(0, -".ics".length));
    if (ics === null) throw new NotFoundException();
    return ics;
  }
}
