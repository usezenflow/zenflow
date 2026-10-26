import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Put,
  UseGuards,
} from "@nestjs/common";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { BusyBlocksService } from "./busy-blocks.service";
import { ReplaceDeviceBusyDto } from "./dto/replace-device-busy.dto";

@Controller("device-calendar")
@UseGuards(CookieAuthGuard)
export class DeviceCalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly busy: BusyBlocksService,
  ) {}

  /** The phone sends the busy time it can see. Accepted only while the phone calendar is the target. */
  @Put("busy")
  @HttpCode(200)
  async replaceBusy(
    @Body() dto: ReplaceDeviceBusyDto,
    @CurrentUser() user: User,
  ) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { calendarTarget: true },
    });
    if (current.calendarTarget !== "DEVICE")
      throw new ConflictException("Turn on the phone calendar first.");
    await this.busy.replace(
      user.id,
      "DEVICE",
      dto.blocks.map((b) => ({
        externalKey: b.externalKey,
        title: b.title,
        start: new Date(b.start),
        end: new Date(b.end),
      })),
    );
    return {
      success: true,
      message: "Busy time saved",
      data: { received: dto.blocks.length },
    };
  }
}
