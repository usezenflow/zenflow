import { proposalWarnings } from "./proposal-warnings";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import type {
  BulkCreateItemResult,
  BulkCreateSessionsResponse,
  BulkDeleteItemResult,
  BulkDeleteSessionsResponse,
  CreateSessionResponse,
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  RemoveTimetableGroupResponse,
  SessionDetailResponse,
  SessionResolveConflictsResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
  SlotPickResponse,
  UpdateSessionResponse,
} from "@zenflow/shared";
import type { SessionEventSource, User } from "../../generated/prisma";
import { BulkCreateSessionsDto } from "./dto/bulk-create-sessions.dto";
import { BulkDeleteSessionsDto } from "./dto/bulk-delete-sessions.dto";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { PlacementChipsService } from "./placement-chips.service";
import { ConflictResolveService } from "../scheduler/io/conflict-resolve.service";

/**
 * Thin facade the controller calls — its methods delegate to the collaborator
 * services, one concern each:
 *  - {@link SessionCrudService}   create / list / suggestions / findById / remove
 *  - {@link SessionUpdateService} `PATCH /sessions/:id`
 *  - {@link SeriesService}        every `SessionSeries` lifecycle op
 *  - {@link SlotPickService}      `POST /sessions/:id/slot-pick`
 *  - {@link ConflictResolveService} `POST /sessions/:id/resolve-conflicts`
 *
 * The wire contract is unchanged — see `sessions.controller.ts`.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly crud: SessionCrudService,
    private readonly series: SeriesService,
    private readonly updates: SessionUpdateService,
    private readonly slotPickService: SlotPickService,
    private readonly chips: PlacementChipsService,
    private readonly conflictResolve: ConflictResolveService,
  ) {}

  async create(
    dto: CreateSessionDto,
    user: User,
  ): Promise<CreateSessionResponse> {
    return this.crud.create(dto, user);
  }

  /**
   * Creates each item through the single-create path, in order. One item's
   * failure is reported on that item and does not stop the others. With
   * `dryRun`, nothing is written and each item reports its proposed start.
   */
  async bulkCreate(
    dto: BulkCreateSessionsDto,
    user: User,
  ): Promise<BulkCreateSessionsResponse> {
    const dryRun = dto.dryRun === true;
    const results: BulkCreateItemResult[] = [];
    for (const [index, item] of dto.items.entries()) {
      results.push(await this.bulkItem(index, item, dryRun, user));
    }
    return { dryRun, results };
  }

  private async bulkItem(
    index: number,
    item: CreateSessionDto,
    dryRun: boolean,
    user: User,
  ): Promise<BulkCreateItemResult> {
    try {
      if (dryRun) {
        const start = await this.crud.proposeCreate(item, user);
        const flags = start
          ? proposalWarnings({
              start,
              durationMinutes: item.durationMinutes,
              deadline: item.deadline ? new Date(item.deadline) : null,
              timezone: user.timezone,
              overlaps: await this.crud.proposeOverlaps(item, user),
            })
          : undefined;
        return {
          index,
          status: "PROPOSED",
          proposedStart: start ? start.toISOString() : null,
          proposedEnd: start
            ? new Date(
                start.getTime() + item.durationMinutes * 60_000,
              ).toISOString()
            : null,
          timezone: user.timezone,
          ...flags,
        };
      }
      const res = await this.create(item, user);
      return {
        index,
        status: "CREATED",
        id: res.id,
        scheduledStartTime: res.scheduledStartTime
          ? new Date(res.scheduledStartTime).toISOString()
          : null,
      };
    } catch (err) {
      return { index, status: "ERROR", ...this.bulkError(err) };
    }
  }

  /**
   * Deletes each item in order: a session or occurrence, a whole recurring
   * series, or a timetable group. One item's failure is reported on that item.
   * With `dryRun`, nothing is deleted and each item reports what would go.
   */
  async bulkDelete(
    dto: BulkDeleteSessionsDto,
    user: User,
  ): Promise<BulkDeleteSessionsResponse> {
    const dryRun = dto.dryRun === true;
    const results: BulkDeleteItemResult[] = [];
    for (const [index, item] of dto.items.entries()) {
      const { kind, id } = item;
      const scope = item.scope ?? "all";
      try {
        if (dryRun) {
          const { title, count } = await this.crud.describeDelete(
            kind,
            id,
            scope,
            user,
          );
          results.push({ index, status: "PREVIEW", kind, id, title, count });
          continue;
        }
        const removed =
          kind === "session"
            ? (await this.remove(id, user), 1)
            : kind === "series"
              ? (await this.removeSeries(id, user)).removedSessionIds.length
              : (
                  await (scope === "following"
                    ? this.removeTimetableGroupFrom(id, user)
                    : this.removeTimetableGroup(id, user))
                ).removedSessionIds.length;
        results.push({ index, status: "DELETED", kind, id, removed });
      } catch (err) {
        results.push({
          index,
          status: "ERROR",
          kind,
          id,
          ...this.bulkError(err),
        });
      }
    }
    return { dryRun, results };
  }

  private bulkError(err: unknown): { code: string; message: string } {
    if (err instanceof HttpException) {
      const body: unknown = err.getResponse();
      const fields =
        typeof body === "object" && body !== null
          ? (body as { code?: unknown; message?: unknown })
          : {};
      const status = (HttpStatus as unknown as Record<number, string>)[
        err.getStatus()
      ];
      return {
        code:
          typeof fields.code === "string" ? fields.code : (status ?? "ERROR"),
        message:
          typeof fields.message === "string" ? fields.message : err.message,
      };
    }
    this.logger.error("Bulk session create failed", err as Error);
    return { code: "INTERNAL_ERROR", message: "Couldn't create this session." };
  }

  list(dto: ListSessionsDto, user: User): Promise<SessionsListResponse> {
    return this.crud.list(dto, user);
  }

  suggestions(
    dto: ListSessionSuggestionsDto,
    user: User,
  ): Promise<SessionSuggestionsResponse> {
    return this.crud.suggestions(dto, user);
  }

  /** Session detail, plus placement chips for a placed TASK. */
  async findById(id: string, user: User): Promise<SessionDetailResponse> {
    const detail = await this.crud.findById(id, user);
    if (
      detail.type !== "TASK" ||
      !detail.scheduledStartTime ||
      detail.id !== id
    )
      return detail;
    const placementChips = await this.chips.forTask(detail, user);
    return { ...detail, placementChips };
  }

  async update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
    origin?: SessionEventSource,
  ): Promise<UpdateSessionResponse> {
    return this.updates.update(id, dto, user, origin);
  }

  async remove(
    id: string,
    user: User,
    origin?: SessionEventSource,
  ): Promise<RemoveSessionResponse> {
    return this.crud.remove(id, user, origin);
  }

  /** Repacks the flexible sessions that overlap `id`; `id` itself stays put. */
  resolveConflicts(
    id: string,
    user: User,
  ): Promise<SessionResolveConflictsResponse> {
    return this.conflictResolve.resolve(user, id);
  }

  async slotPick(
    id: string,
    dto: SlotPickDto,
    user: User,
  ): Promise<SlotPickResponse> {
    return this.slotPickService.recordPick(id, dto, user);
  }

  async truncateSeriesFrom(
    seriesId: string,
    fromStartISO: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.series.truncateFrom(seriesId, fromStartISO, user);
  }

  async removeSeries(
    seriesId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.series.removeSeries(seriesId, user);
  }

  async removeTimetableGroupFrom(
    sessionId: string,
    user: User,
  ): Promise<RemoveTimetableGroupResponse> {
    return this.crud.removeTimetableGroupFrom(sessionId, user);
  }

  async removeTimetableGroup(
    sessionId: string,
    user: User,
  ): Promise<RemoveTimetableGroupResponse> {
    return this.crud.removeTimetableGroup(sessionId, user);
  }
}
