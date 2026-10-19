import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SPIRITS } from "@zenflow/spirits";
import type {
  SpiritEgg,
  SpiritHatchResponse,
  SpiritsResponse,
} from "@zenflow/shared";
import type {
  Egg,
  SpiritRarity as DbSpiritRarity,
  User,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { dayKey } from "../streaks/core/streak";
import {
  DAILY_SPARK_CAP,
  EGG_SPARKS,
  MAX_POWER,
  SPARK_WINDOW_DAYS,
} from "./core/constants";
import { legendaryDue, perksFor, powerOf } from "./core/power";
import { rollSpirit } from "./core/roll";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Spirit eggs and hatching. Each START session event settled inside the
 * window adds one spark to the incubating egg, at most `DAILY_SPARK_CAP` per
 * user day. The ledger keys on the event id, so a start grants one spark even
 * when this runs more than once. Sparks settle on read and through
 * {@link SpiritsService.credit}, which the writers of `START` / `COMPLETE`
 * events call so progress does not wait for the next read.
 */
/**
 * One spark per assignment or prep plan, however often it is re-checked. A prep
 * plan for an assignment shares the assignment's key, so the pair pays once.
 * `null` for a START, which is already unique by its event.
 */
function sparkKeyOf(e: {
  eventType: string;
  sessionId: string | null;
  session: {
    type: string;
    prepForSessionId: string | null;
    prepForSession: { type: string } | null;
  } | null;
}): string | null {
  if (e.eventType !== "COMPLETE") return null;
  if (e.session?.prepForSession?.type === "ASSIGNMENT")
    return e.session.prepForSessionId;
  return e.sessionId;
}

@Injectable()
export class SpiritsService {
  private readonly logger = new Logger(SpiritsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async overview(user: User, now: Date = new Date()): Promise<SpiritsResponse> {
    const egg = await this.openEgg(user, now);
    const owned = await this.ownedSpiritIds(user.id);
    return this.toResponse(egg, owned);
  }

  async hatch(
    user: User,
    eggId: string,
    now: Date = new Date(),
  ): Promise<SpiritHatchResponse> {
    const egg = await this.prisma.egg.findFirst({
      where: { id: eggId, userId: user.id },
    });
    if (!egg) throw new NotFoundException("Egg not found");
    if (egg.status !== "READY")
      throw new ConflictException("Egg is not ready to hatch");

    const history = await this.prisma.spirit.findMany({
      where: { userId: user.id },
      orderBy: { hatchedAt: "desc" },
      select: { rarity: true },
    });
    const spirit = rollSpirit(
      { userId: user.id, eggId, secret: this.rollSecret() },
      legendaryDue(history.map((h) => h.rarity)),
    );
    const rarity = spirit.rarity.toUpperCase() as DbSpiritRarity;

    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.egg.updateMany({
        where: { id: eggId, userId: user.id, status: "READY" },
        data: { status: "HATCHED", hatchedAt: now },
      });
      if (moved.count !== 1)
        throw new ConflictException("Egg is not ready to hatch");
      await tx.spirit.create({
        data: { userId: user.id, eggId, spiritId: spirit.id, rarity },
      });
      await tx.egg.create({ data: { userId: user.id, createdAt: now } });
    });

    const next = await this.openEgg(user, now);
    const power = powerOf(await this.ownedSpiritIds(user.id));
    return {
      spirit: { spiritId: spirit.id, rarity: spirit.rarity },
      egg: toEgg(next),
      power,
    };
  }

  /**
   * Settle the user's open egg now and return the sparks it just gained. Call
   * after writing a `START` / `COMPLETE` event. Never throws: the event is
   * already stored and the next read settles it anyway.
   */
  async credit(userId: string, now: Date = new Date()): Promise<number> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return 0;
      return await this.settleSparks(
        user,
        await this.currentEgg(user, now),
        now,
      );
    } catch (err) {
      this.logger.warn(`spark credit failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** The egg still open (incubating or ready), created on first read. */
  private async openEgg(user: User, now: Date): Promise<Egg> {
    const egg = await this.currentEgg(user, now);
    await this.settleSparks(user, egg, now);
    return this.prisma.egg.findUniqueOrThrow({ where: { id: egg.id } });
  }

  private async currentEgg(user: User, now: Date): Promise<Egg> {
    let egg = await this.prisma.egg.findFirst({
      where: { userId: user.id, status: { not: "HATCHED" } },
      orderBy: { createdAt: "desc" },
    });
    if (!egg) {
      // The first egg counts starts from the account's creation, so starts
      // before the Spirits tab was opened still count (inside the window).
      const hatched = await this.prisma.egg.count({
        where: { userId: user.id },
      });
      egg = await this.prisma.egg.create({
        data: {
          userId: user.id,
          createdAt: hatched === 0 ? user.createdAt : now,
        },
      });
    }
    return egg;
  }

  /** Grant sparks for unsettled events; returns how many were added. */
  private async settleSparks(user: User, egg: Egg, now: Date): Promise<number> {
    if (egg.status !== "INCUBATING") return 0;
    const since = new Date(
      Math.max(
        egg.createdAt.getTime(),
        now.getTime() - SPARK_WINDOW_DAYS * DAY_MS,
      ),
    );
    // A START; the check-off of a linked prep plan done at or after its slot start;
    // or the completion of an ingested assignment.
    const candidates = await this.prisma.sessionEvent.findMany({
      where: {
        userId: user.id,
        occurredAt: { gte: since, lte: now },
        OR: [
          { eventType: "START" },
          {
            eventType: "COMPLETE",
            session: { prepForSessionId: { not: null }, deleted: false },
          },
          {
            eventType: "COMPLETE",
            session: {
              type: "ASSIGNMENT",
              source: { not: "USER" },
              seriesId: null,
              deleted: false,
            },
          },
        ],
      },
      select: {
        id: true,
        occurredAt: true,
        eventType: true,
        sessionId: true,
        session: {
          select: {
            type: true,
            scheduledStartTime: true,
            prepForSessionId: true,
            prepForSession: { select: { type: true } },
          },
        },
      },
      orderBy: { occurredAt: "asc" },
    });
    const starts = candidates
      .filter(
        (e) =>
          e.eventType === "START" ||
          e.session?.type === "ASSIGNMENT" ||
          (e.session?.scheduledStartTime != null &&
            e.occurredAt >= e.session.scheduledStartTime),
      )
      .map((e) => ({ ...e, sparkKey: sparkKeyOf(e) }));
    if (starts.length === 0) return 0;

    const tz = user.timezone;
    const days = [...new Set(starts.map((s) => dayKey(s.occurredAt, tz)))];
    const [granted, ledgerDays] = await Promise.all([
      this.prisma.sparkLedger.findMany({
        where: { sessionEventId: { in: starts.map((s) => s.id) } },
        select: { sessionEventId: true },
      }),
      this.prisma.sparkLedger.findMany({
        where: { userId: user.id, day: { in: days } },
        select: { day: true },
      }),
    ]);

    const done = new Set(granted.map((g) => g.sessionEventId.toString()));
    const perDay = new Map<string, number>();
    for (const row of ledgerDays)
      perDay.set(row.day, (perDay.get(row.day) ?? 0) + 1);

    const room = EGG_SPARKS - egg.sparks;
    const rows: {
      userId: string;
      eggId: string;
      sessionEventId: bigint;
      sessionId: string | null;
      day: string;
    }[] = [];
    const prepIds = starts.flatMap((s) => (s.sparkKey ? [s.sparkKey] : []));
    const sparkedPreps = new Set(
      prepIds.length === 0
        ? []
        : (
            await this.prisma.sparkLedger.findMany({
              where: { userId: user.id, sessionId: { in: prepIds } },
              select: { sessionId: true },
            })
          ).map((r) => r.sessionId),
    );
    for (const start of starts) {
      if (rows.length >= room) break;
      if (done.has(start.id.toString())) continue;
      const prepId = start.sparkKey;
      if (prepId && sparkedPreps.has(prepId)) continue;
      const day = dayKey(start.occurredAt, tz);
      if ((perDay.get(day) ?? 0) >= DAILY_SPARK_CAP) continue;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      if (prepId) sparkedPreps.add(prepId);
      rows.push({
        userId: user.id,
        eggId: egg.id,
        sessionEventId: start.id,
        sessionId: prepId,
        day,
      });
    }
    if (rows.length === 0) return 0;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.sparkLedger.createMany({
        data: rows,
        skipDuplicates: true,
      });
      if (created.count === 0) return 0;
      await tx.egg.update({
        where: { id: egg.id },
        data: { sparks: { increment: created.count } },
      });
      await tx.egg.updateMany({
        where: {
          id: egg.id,
          status: "INCUBATING",
          sparks: { gte: EGG_SPARKS },
        },
        data: { status: "READY" },
      });
      return created.count;
    });
  }

  private async ownedSpiritIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.spirit.findMany({
      where: { userId },
      select: { spiritId: true },
    });
    return rows.map((r) => r.spiritId);
  }

  private toResponse(egg: Egg, ownedIds: string[]): SpiritsResponse {
    const counts = new Map<string, number>();
    for (const id of ownedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const power = powerOf(ownedIds);
    return {
      egg: toEgg(egg),
      collection: SPIRITS.map((s) => ({
        spiritId: s.id,
        rarity: s.rarity,
        count: counts.get(s.id) ?? 0,
      })),
      power,
      maxPower: MAX_POWER,
      perks: perksFor(power),
    };
  }

  private rollSecret(): string {
    const secret = this.config.get<string>("SPIRIT_ROLL_SECRET");
    if (!secret) throw new Error("SPIRIT_ROLL_SECRET is not set");
    return secret;
  }
}

function toEgg(egg: Pick<Egg, "id" | "status" | "sparks">): SpiritEgg {
  return {
    id: egg.id,
    status: egg.status === "READY" ? "ready" : "incubating",
    sparks: egg.sparks,
    sparksNeeded: EGG_SPARKS,
  };
}
