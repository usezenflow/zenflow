import { Injectable } from "@nestjs/common";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  RemoveTimetableGroupResponse,
  SessionDetailResponse,
  SessionSkipResponse,
  SessionStartResponse,
  SessionResolveConflictsResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
  SlotPickResponse,
  UpdateSessionResponse,
} from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { type SkipScope, SessionSkipService } from "./session-skip.service";
import { SessionStartService } from "./session-start.service";
import { NoteFilesService } from "../files/note-files.service";
import { RemindersService } from "../reminders/reminders.service";
import { ConflictResolveService } from "../scheduler/io/conflict-resolve.service";

/**
 * Thin facade the controller calls — its methods delegate to the collaborator
 * services, one concern each:
 *  - {@link SessionCrudService}   create / list / suggestions / findById / remove
 *  - {@link SessionUpdateService} `PATCH /sessions/:id`
 *  - {@link SeriesService}        every `SessionSeries` lifecycle op
 *  - {@link SlotPickService}      `POST /sessions/:id/slot-pick`
 *  - {@link SessionSkipService}   `POST|DELETE /sessions/:id/skip`
 *  - {@link SessionStartService}  `POST /sessions/:id/start`
 *  - {@link ConflictResolveService} `POST /sessions/:id/resolve-conflicts`
 *
 * The wire contract is unchanged — see `sessions.controller.ts`.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly crud: SessionCrudService,
    private readonly series: SeriesService,
    private readonly updates: SessionUpdateService,
    private readonly slotPickService: SlotPickService,
    private readonly skips: SessionSkipService,
    private readonly sessionStart: SessionStartService,
    private readonly reminders: RemindersService,
    private readonly noteFiles: NoteFilesService,
    private readonly conflictResolve: ConflictResolveService,
  ) {}

  /**
   * Reminders are persisted right after the row(s) exist (default: one at the user's
   * `defaultReminderMinutes` for non-DND, none if 0; explicit list/[] honoured) and the response is stamped
   * with them. Validation runs first so a bad request inserts nothing.
   */
  async create(
    dto: CreateSessionDto,
    user: User,
  ): Promise<CreateSessionResponse> {
    dto.note = await this.noteFiles.normalize(dto.note, user.id);
    const minutes = this.reminders.resolveForCreate(
      dto.type,
      dto.reminders,
      user.defaultReminderMinutes,
    );
    const res = await this.crud.create(dto, user);
    const { applied, skipped } = await this.reminders.replace(
      [res.id],
      minutes,
    );
    res.reminders = applied;
    if (skipped.length > 0) res.skippedReminders = skipped;
    return res;
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

  findById(id: string, user: User): Promise<SessionDetailResponse> {
    return this.crud.findById(id, user);
  }

  async update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse> {
    dto.note = await this.noteFiles.normalize(dto.note, user.id);
    const target =
      dto.reminders !== undefined
        ? await this.reminders.resolveUpdateTargets(id, dto.reminders, user)
        : null;
    const res = await this.noteFiles.releasingUnreferenced(user.id, () =>
      this.updates.update(id, dto, user),
    );
    if (target) {
      const { applied, skipped } = await this.reminders.replace(
        target.sessionIds,
        target.minutes,
      );
      res.reminders = applied;
      if (skipped.length > 0) res.skippedReminders = skipped;
    }
    return res;
  }

  async remove(id: string, user: User): Promise<RemoveSessionResponse> {
    const res = await this.noteFiles.releasingUnreferenced(user.id, () =>
      this.crud.remove(id, user),
    );
    return res;
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
    const res = await this.slotPickService.recordPick(id, dto, user);
    return res;
  }

  /** Set (`on`) or undo the skipped state of a session or occurrence. */
  setSkip(
    id: string,
    on: boolean,
    user: User,
    scope?: SkipScope,
  ): Promise<SessionSkipResponse> {
    return this.skips.set(id, on, user, scope);
  }

  /** Skip a timetable group, or from `sessionId` onward (`POST /sessions/timetable-group/:sessionId/skip[/from]`). */
  skipTimetableGroup(
    sessionId: string,
    from: boolean,
    user: User,
  ): Promise<{ skippedSessionIds: string[] }> {
    return this.skips.skipTimetableGroup(sessionId, from, user);
  }

  /** Records that the user is in this placed block now (`POST /sessions/:id/start`). */
  recordStart(id: string, user: User): Promise<SessionStartResponse> {
    return this.sessionStart.record(id, user);
  }

  async truncateSeriesFrom(
    seriesId: string,
    fromStartISO: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const res = await this.noteFiles.releasingUnreferenced(user.id, () =>
      this.series.truncateFrom(seriesId, fromStartISO, user),
    );
    return res;
  }

  async removeSeries(
    seriesId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const res = await this.noteFiles.releasingUnreferenced(user.id, () =>
      this.series.removeSeries(seriesId, user),
    );
    return res;
  }

  async removeTimetableGroupFrom(
    sessionId: string,
    user: User,
  ): Promise<RemoveTimetableGroupResponse> {
    const res = await this.noteFiles.releasingUnreferenced(user.id, () =>
      this.crud.removeTimetableGroupFrom(sessionId, user),
    );
    return res;
  }

  async removeTimetableGroup(
    sessionId: string,
    user: User,
  ): Promise<RemoveTimetableGroupResponse> {
    const res = await this.noteFiles.releasingUnreferenced(user.id, () =>
      this.crud.removeTimetableGroup(sessionId, user),
    );
    return res;
  }
}
