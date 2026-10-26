import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 86_400_000;
const SLOT_MS = 15 * 60_000;
/** Same window the sync keeps in step, so busy time covers what the scheduler plans. */
const PAST_DAYS = 2;
const AHEAD_DAYS = 120;
const TITLE_MAX = 200;

export type BusySource = "GOOGLE" | "DEVICE";

export interface BusyItem {
  /** Stable id within `source`, e.g. `<calendar>:<event>`. */
  externalKey: string;
  title: string;
  start: Date;
  end: Date;
}

/** The busy block for a timed event: start rounded down, end rounded up to 15 minutes. */
export function busyBlock(
  start: Date,
  end: Date,
): { start: Date; durationMinutes: number } | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) return null;
  const from = Math.floor(start.getTime() / SLOT_MS) * SLOT_MS;
  const to = Math.ceil(end.getTime() / SLOT_MS) * SLOT_MS;
  return { start: new Date(from), durationMinutes: (to - from) / 60_000 };
}

/**
 * Busy time from another calendar, kept as read-only `DND` sessions so the
 * scheduler plans around it. The sync never writes these rows back.
 */
@Injectable()
export class BusyBlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /** The window busy time is kept for, around `now`. */
  window(now = new Date()): { from: Date; to: Date } {
    return {
      from: new Date(now.getTime() - PAST_DAYS * DAY_MS),
      to: new Date(now.getTime() + AHEAD_DAYS * DAY_MS),
    };
  }

  /**
   * Makes the `source` busy time inside the window match `items`: new blocks
   * are created, changed ones updated, and blocks no longer listed are hidden.
   */
  async replace(
    userId: string,
    source: BusySource,
    items: BusyItem[],
    now = new Date(),
  ): Promise<void> {
    const { from, to } = this.window(now);
    const prefix = `${source.toLowerCase()}:`;
    const wanted = new Map<
      string,
      { title: string; start: Date; durationMinutes: number }
    >();
    for (const item of items) {
      const block = busyBlock(item.start, item.end);
      if (!block || block.start < from || block.start > to) continue;
      wanted.set(prefix + item.externalKey, {
        title: (item.title || "Busy").slice(0, TITLE_MAX),
        ...block,
      });
    }

    const existing = await this.prisma.session.findMany({
      where: { userId, source },
      select: {
        id: true,
        externalKey: true,
        title: true,
        scheduledStartTime: true,
        durationMinutes: true,
        deleted: true,
      },
    });
    const byKey = new Map(existing.map((s) => [s.externalKey, s]));
    const writes: Prisma.PrismaPromise<unknown>[] = [];

    for (const [externalKey, block] of wanted) {
      const row = byKey.get(externalKey);
      if (
        row &&
        !row.deleted &&
        row.title === block.title &&
        row.durationMinutes === block.durationMinutes &&
        row.scheduledStartTime?.getTime() === block.start.getTime()
      )
        continue;
      writes.push(
        row
          ? this.prisma.session.update({
              where: { id: row.id },
              data: {
                title: block.title,
                durationMinutes: block.durationMinutes,
                scheduledStartTime: block.start,
                deleted: false,
              },
            })
          : this.prisma.session.create({
              data: {
                userId,
                externalKey,
                source,
                type: "DND",
                title: block.title,
                durationMinutes: block.durationMinutes,
                scheduledStartTime: block.start,
              },
            }),
      );
    }

    // Gone from the other calendar (or moved out of the window): hide the block, keep the row.
    for (const row of existing) {
      if (
        row.deleted ||
        wanted.has(row.externalKey ?? "") ||
        !row.scheduledStartTime ||
        row.scheduledStartTime < from ||
        row.scheduledStartTime > to
      )
        continue;
      writes.push(
        this.prisma.session.update({
          where: { id: row.id },
          data: { deleted: true },
        }),
      );
    }

    if (writes.length > 0) await this.prisma.$transaction(writes);
  }
}
