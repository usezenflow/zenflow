import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Redirect,
  UseGuards,
} from "@nestjs/common";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { GoogleCalendarService } from "./google-calendar.service";

@Controller("google-calendar")
export class GoogleCalendarController {
  constructor(private readonly google: GoogleCalendarService) {}

  @Get()
  @UseGuards(CookieAuthGuard)
  async status(@CurrentUser() user: User) {
    return {
      success: true,
      message: "Google Calendar",
      data: await this.google.status(user),
    };
  }

  @Post("connect")
  @UseGuards(CookieAuthGuard)
  connect(@CurrentUser() user: User) {
    return {
      success: true,
      message: "Google sign-in link",
      data: this.google.connectUrl(user),
    };
  }

  @Post("sync")
  @HttpCode(202)
  @UseGuards(CookieAuthGuard)
  async sync(@CurrentUser() user: User) {
    return {
      success: true,
      message: "Sync queued",
      data: await this.google.syncNow(user),
    };
  }

  @Delete()
  @UseGuards(CookieAuthGuard)
  async disconnect(@CurrentUser() user: User) {
    return {
      success: true,
      message: "Google Calendar disconnected",
      data: await this.google.disconnect(user),
    };
  }

  /** Google sends the browser here. The signed `state` identifies the user. */
  @Get("callback")
  @Redirect()
  async callback(
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ) {
    return { url: await this.google.complete(code, state, error) };
  }

  /** Push notification from Google. It carries no body; the channel token proves the sender. */
  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Headers("x-goog-channel-id") channelId?: string,
    @Headers("x-goog-channel-token") token?: string,
    @Headers("x-goog-resource-state") state?: string,
    @Headers("x-goog-resource-id") resourceId?: string,
  ): Promise<void> {
    if (channelId)
      await this.google.onNotification(channelId, token, state, resourceId);
  }
}
