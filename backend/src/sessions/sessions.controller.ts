import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { CreateSessionDto } from "./dto/create-session.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { DeadlineOptionsDto } from "./dto/deadline-options.dto";
import { AllowApiToken } from "../api-access/allow-api-token.decorator";
import { ApiTokenGuard } from "../api-access/api-token.guard";
import { BulkCreateSessionsDto } from "./dto/bulk-create-sessions.dto";
import { BulkDeleteSessionsDto } from "./dto/bulk-delete-sessions.dto";
import { BulkUpdateSessionsDto } from "./dto/bulk-update-sessions.dto";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { deadlineOptions } from "./utils/deadline-options";
import { ConfirmPlacementDto } from "./dto/confirm-placement.dto";
import { PlacementPlanService } from "./placement-plan.service";
import { ReplanService } from "./replan.service";
import { buildRecap, findFreeSlots } from "./session-recap";
import {
  FreeSlotsDto,
  InsightRangeDto,
  ReplanDto,
} from "./dto/insight-range.dto";
import { plainToInstance } from "class-transformer";

@Controller("sessions")
@UseGuards(ApiTokenGuard)
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly placementPlans: PlacementPlanService,
    private readonly replans: ReplanService,
  ) {}

  // NOTE: must precede @Post(":id/...") routes so "placement" isn't matched as an :id.
  /** Apply a plan the scheduler asked to confirm (ADR-0022). Atomic. */
  @Post("placement/confirm")
  async confirmPlacement(
    @Body() dto: ConfirmPlacementDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.placementPlans.confirm(user, dto.planId);
    return { success: true, message: "Placement confirmed", data };
  }

  /** Revert every move one undo group made (a drag, a cascade or a confirmed plan). */
  @Post("undo/:groupId")
  async undoPlacement(
    @Param("groupId") groupId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.placementPlans.undo(user, groupId);
    return {
      success: true,
      message: `Restored ${data.restored.length} session(s)`,
      data,
    };
  }

  @Post()
  async create(@Body() dto: CreateSessionDto, @CurrentUser() user: User) {
    const data = await this.sessionsService.create(dto, user);
    return { success: true, message: "Session created", data };
  }

  /** Revert the newest undoable change, whatever its group. */
  @Post("undo-latest")
  async undoLatest(@CurrentUser() user: User) {
    const data = await this.placementPlans.undoLatest(user);
    return {
      success: true,
      message: `Restored ${data.restored.length} session(s)`,
      data,
    };
  }

  /** Preview a replan of the range. Nothing changes until `replan/confirm`. */
  @Post("replan")
  async replan(@Body() dto: ReplanDto, @CurrentUser() user: User) {
    const data = await this.replans.plan(user, dto.from, dto.to, dto.change);
    return { success: true, message: "Replan proposed", data };
  }

  /** Apply the replan for the range; it is recomputed, so it can differ from the preview. */
  @Post("replan/confirm")
  async confirmReplan(@Body() dto: ReplanDto, @CurrentUser() user: User) {
    const data = await this.replans.apply(user, dto.from, dto.to, dto.change);
    return { success: true, message: "Replan applied", data };
  }

  /** Up to 50 sessions in one call (`dryRun` previews), each created or proposed on its own. */
  @Post("bulk")
  @AllowApiToken()
  async bulkCreate(
    @Body() dto: BulkCreateSessionsDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.bulkCreate(dto, user);
    const created = data.results.filter((r) => r.status === "CREATED").length;
    return {
      success: true,
      message: data.dryRun
        ? `Proposed ${data.results.length} sessions`
        : `Created ${created} of ${data.results.length} sessions`,
      data,
    };
  }

  /** Up to 50 deletions in one call: sessions, recurring series or timetable groups. */
  @Post("bulk-delete")
  @AllowApiToken()
  async bulkDelete(
    @Body() dto: BulkDeleteSessionsDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.bulkDelete(dto, user);
    const gone = data.results.filter((r) => r.status === "DELETED").length;
    return {
      success: true,
      message: data.dryRun
        ? `Previewed ${data.results.length} deletions`
        : `Deleted ${gone} of ${data.results.length} items`,
      data,
    };
  }

  /** Up to 50 session patches in one call. */
  @Post("bulk-update")
  async bulkUpdate(
    @Body() dto: BulkUpdateSessionsDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.bulkUpdate(dto, user);
    const done = data.results.filter((r) => r.status === "UPDATED").length;
    return {
      success: true,
      message: `Updated ${done} of ${data.results.length} sessions`,
      data,
    };
  }

  @Get()
  @AllowApiToken()
  async list(@Query() dto: ListSessionsDto, @CurrentUser() user: User) {
    const data = await this.sessionsService.list(dto, user);
    return {
      success: true,
      message: `Found ${data.sessions.length} sessions`,
      data,
    };
  }

  // NOTE: must precede @Get(":id") so "recap" isn't matched as an :id.
  @Get("recap")
  async recap(@Query() dto: InsightRangeDto, @CurrentUser() user: User) {
    const { sessions } = await this.sessionsService.list(
      plainToInstance(ListSessionsDto, dto),
      user,
    );
    const data = buildRecap(
      sessions,
      dto.from,
      dto.to,
      user.timezone,
      user.preferenceMatrix,
    );
    return { success: true, message: "Recap", data };
  }

  // NOTE: must precede @Get(":id") so "free-slots" isn't matched as an :id.
  @Get("free-slots")
  async freeSlots(@Query() dto: FreeSlotsDto, @CurrentUser() user: User) {
    const { sessions } = await this.sessionsService.list(
      plainToInstance(ListSessionsDto, { from: dto.from, to: dto.to }),
      user,
    );
    const data = findFreeSlots(
      sessions,
      dto.from,
      dto.to,
      dto.durationMinutes,
      user.timezone,
    );
    return { success: true, message: "Free slots", data };
  }

  // NOTE: must precede @Get(":id") so "suggestions" isn't matched as an :id.
  @Get("suggestions")
  async suggestions(
    @Query() dto: ListSessionSuggestionsDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.suggestions(dto, user);
    return {
      success: true,
      message: `Found ${data.suggestions.length} suggestions`,
      data,
    };
  }

  // NOTE: must precede @Get(":id") so "deadline-options" isn't matched as an :id.
  @Get("deadline-options")
  deadlineOptions(@Query() dto: DeadlineOptionsDto, @CurrentUser() user: User) {
    const data = deadlineOptions(dto.anchor, user);
    return { success: true, message: "Deadline options", data };
  }

  @Get(":id")
  @AllowApiToken()
  async findOne(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.findById(id, user);
    return { success: true, message: "Found session", data };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.update(id, dto, user);
    return { success: true, message: "Session updated", data };
  }

  @Post(":id/resolve-conflicts")
  async resolveConflicts(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.resolveConflicts(id, user);
    return { success: true, message: "Conflicts resolved", data };
  }

  @Post(":id/slot-pick")
  async slotPick(
    @Param("id") id: string,
    @Body() dto: SlotPickDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.slotPick(id, dto, user);
    return { success: true, message: "Slot pick recorded", data };
  }

  // NOTE: must precede @Delete(":id") so "series" isn't matched as an :id.
  @Delete("series/:seriesId")
  async removeSeries(
    @Param("seriesId") seriesId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeSeries(seriesId, user);
    return {
      success: true,
      message: `Deleted ${data.removedSessionIds.length} sessions`,
      data,
    };
  }

  // "Delete this occurrence and all following" for a recurring (rrule) series:
  // pulls the rrule's UNTIL back to just before `?from=<ISO instant>`.
  @Delete("series/:seriesId/truncate")
  async truncateSeriesFrom(
    @Param("seriesId") seriesId: string,
    @Query("from") from: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.truncateSeriesFrom(
      seriesId,
      from,
      user,
    );
    return { success: true, message: "Series truncated", data };
  }

  // NOTE: must precede @Delete(":id") so "timetable-group" isn't matched as
  // an :id, same ordering constraint as the "series/..." routes above.
  @Delete("timetable-group/:sessionId/from")
  async removeTimetableGroupFrom(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeTimetableGroupFrom(
      sessionId,
      user,
    );
    return {
      success: true,
      message: `Deleted ${data.removedSessionIds.length} sessions`,
      data,
    };
  }

  @Delete("timetable-group/:sessionId")
  async removeTimetableGroup(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.sessionsService.removeTimetableGroup(
      sessionId,
      user,
    );
    return {
      success: true,
      message: `Deleted ${data.removedSessionIds.length} sessions`,
      data,
    };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: User) {
    const data = await this.sessionsService.remove(id, user);
    return { success: true, message: "Session deleted", data };
  }
}
