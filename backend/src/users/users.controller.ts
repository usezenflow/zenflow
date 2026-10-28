import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Put,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { RateLimit } from "@limitkit/nest";
import type { Response } from "express";
import { PaletteService } from "./palette.service";
import { paletteRules } from "./palette-rate-limit";
import { UpdateUserDto } from "./dto/update-user.dto";
import { SetCalendarTargetDto } from "./dto/set-calendar-target.dto";
import { toUserResponse } from "./user-response";
import { StudentService } from "./student.service";
import { UsersService } from "./users.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";

@Controller("users")
@UseGuards(CookieAuthGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private studentService: StudentService,
    private paletteService: PaletteService,
  ) {}

  @Get("me")
  me(@CurrentUser() user: User) {
    return { success: true, data: toUserResponse(user) };
  }

  @Get("me/student")
  async student(@CurrentUser() user: User) {
    return { success: true, data: await this.studentService.profile(user.id) };
  }

  @Get("me/marks")
  async marks(@CurrentUser() user: User) {
    return { success: true, data: await this.studentService.marks(user.id) };
  }

  @Patch("update/basic-info")
  async updateBasicInfo(@Body() dto: UpdateUserDto, @CurrentUser() user: User) {
    const updated = await this.usersService.update(user.id, dto);
    return { success: true, data: toUserResponse(updated) };
  }

  @Patch("update/calendar-target")
  async updateCalendarTarget(
    @Body() dto: SetCalendarTargetDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.usersService.setCalendarTarget(
      user.id,
      dto.target,
    );
    return { success: true, data: toUserResponse(updated) };
  }

  @Get("me/preference-matrix")
  async preferenceMatrix(@CurrentUser() user: User) {
    const data = await this.usersService.getPreferenceMatrix(user);
    return { success: true, data };
  }

  @RateLimit({ rules: paletteRules })
  @Get("me/palette")
  async palette(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    const palette = await this.paletteService.get(user.id);
    if (!palette) {
      res.status(204);
      return;
    }
    res.set({ "Content-Type": "application/octet-stream", ETag: palette.etag });
    return new StreamableFile(palette.data);
  }

  @RateLimit({ rules: paletteRules })
  @Put("me/palette")
  async putPalette(
    @CurrentUser() user: User,
    @Body() body: Buffer,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const etag = await this.paletteService.put(
      user.id,
      Buffer.isBuffer(body) ? body : Buffer.alloc(0),
      ifMatch,
    );
    res.set("ETag", etag);
    return { success: true };
  }
}
