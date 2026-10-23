import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  PLACEMENT_CONTRACT_VERSION,
  type ResolveRequest,
  type SessionResolveConflictsResponse,
} from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { DAY_MS } from "../core/slot";
import { isFlexible, DisplacementService } from "./displacement.service";
import { loadScheduleItems, type ScheduleItem } from "./day-load";
import { PlacementClient } from "./placement-client.service";

/** How far past the anchor the repack may search for a free day. */
const RESOLVE_HORIZON_DAYS = 30;

const interval = (it: ScheduleItem) => ({
  startMs: it.start - (it.bufferMs ?? 0),
  endMs: it.end + (it.bufferMs ?? 0),
});

/**
 * Auto-resolve for an overlap (long press on a conflicting block). The anchor
 * session stays put. Flexible sessions that overlap it are repacked across
 * the horizon by Python `POST /v1/resolve`; fixed sessions, recurring
 * occurrences and the anchor itself are obstacles. Moves are recorded as
 * `SYSTEM_MOVE` under one undo group.
 */
@Injectable()
export class ConflictResolveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PlacementClient,
    private readonly displacement: DisplacementService,
  ) {}

  async resolve(
    user: User,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<SessionResolveConflictsResponse> {
    const nowMs = now.getTime();
    const items = await loadScheduleItems(this.prisma, {
      userId: user.id,
      rangeStartMs: nowMs,
      rangeEndMs: nowMs + RESOLVE_HORIZON_DAYS * DAY_MS,
      timezone: user.timezone,
    });
    const anchor = items.find((it) => it.id === sessionId);
    if (!anchor) throw new NotFoundException("Session not found");

    const blockers = items.filter(
      (it) =>
        it.id !== null &&
        it.id !== anchor.id &&
        isFlexible(it) &&
        it.start < anchor.end &&
        it.end > anchor.start,
    );
    if (blockers.length === 0) {
      return { moved: [], lateSessionIds: [] };
    }

    const blockerIds = new Set(blockers.map((b) => b.id));
    const horizonEndMs = anchor.end + RESOLVE_HORIZON_DAYS * DAY_MS;
    const request: ResolveRequest = {
      contractVersion: PLACEMENT_CONTRACT_VERSION,
      requestId: randomUUID(),
      nowMs,
      timezone: user.timezone,
      horizonEndMs,
      anchor: interval(anchor),
      flexible: blockers.map((b) => ({
        id: b.id as string,
        durationMinutes: b.durationMinutes,
        deadlineMs: b.deadlineMs as number,
        startMs: b.start,
      })),
      fixed: items
        .filter((it) => it.id !== anchor.id && !blockerIds.has(it.id ?? ""))
        .map(interval),
      horizonOccupied: items.filter((it) => it.id !== anchor.id).map(interval),
      preferenceMatrix: user.preferenceMatrix,
    };

    const res = await this.client.resolve(request);
    if (!res) {
      throw new ServiceUnavailableException("Auto resolve is unavailable");
    }
    if (res.outcome === "INFEASIBLE") {
      throw new ConflictException("No layout fits these sessions");
    }

    const groupId = randomUUID();
    const durationOf = new Map(
      blockers.map((b) => [b.id as string, b.durationMinutes]),
    );
    const moves = res.moves.map((m) => ({
      id: m.id,
      fromMs: m.fromMs,
      toMs: m.toMs,
    }));
    await this.displacement.applyMoves(
      user.id,
      moves,
      (id) => durationOf.get(id) ?? 0,
      groupId,
    );

    return {
      moved: moves.map((m) => m.id),
      lateSessionIds: res.lateIds,
      ...(moves.length ? { undoGroupId: groupId } : {}),
    };
  }
}
