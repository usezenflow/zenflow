import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { RecordClientEventsDto } from "./dto/record-client-events.dto";
import { ClientEventsService } from "./client-events.service";

@Controller("client-events")
@UseGuards(CookieAuthGuard)
export class ClientEventsController {
  constructor(private readonly clientEvents: ClientEventsService) {}

  @Post()
  async record(@Body() dto: RecordClientEventsDto, @CurrentUser() user: User) {
    const data = await this.clientEvents.record(dto, user);
    return { success: true, message: "Client events recorded", data };
  }
}
