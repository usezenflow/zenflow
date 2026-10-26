import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  GoogleCalendarClient,
  type GoogleEventItem,
} from "./google-calendar.client";

const DAY_MS = 86_400_000;
const SLOT_MS = 15 * 60_000;
/** Same window the sync keeps in step, so imported busy time covers what the scheduler plans. */
const PAST_DAYS = 2;
const AHEAD_DAYS = 120;
const TITLE_MAX = 200;

/** The busy block for a timed event: start rounded down and end rounded up to 15 minutes. */
export function busyBlock(
  item: GoogleEventItem,
): { start: Date; durationMinutes: number } | null {
  const start = item.start?.dateTime ? new Date(item.start.dateTime) : null;
  const end = item.end?.dateTime ? new Date(item.end.dateTime) : null;
  if (!start || !end || end <= start) return null;
  const from = Math.floor(start.getTime() / SLOT_MS) * SLOT_MS;
  const to = Math.ceil(end.getTime() / SLOT_MS) * SLOT_MS;
  return { start: new Date(from), durationMinutes: (to - from) / 60_000 };
}

/**
 * Mirrors the user's other calendars into Zenflow as busy `DND` sessions, so
 * the scheduler plans around them. These sessions are read only: the sync
 * never writes them to Google.
 */
@Injectable()
export class CalendarImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: GoogleCalendarClient,
  ) {}

  async importUser(
    userId: string,
    token: string,
    ownCalendarId: string,
    now = new Date(),
  ): Promise<void> {
    const timeMin = new Date(now.getTime() - PAST_DAYS * DAY_MS);
    const timeMax = new Date(now.getTime() + AHEAD_DAYS * DAY_MS);

    const calendars = (await this.client.listCalendars(token)).filter(
      (c) => c.selected && c.id !== ownCalendarId,
    );
    const wanted = new Map<
      string,
      { title: string; start: Date; durationMinutes: number }
    >();
    for (const calendar of calendars) {
      const items = await this.client.listWindow(
        token,
        calendar.id,
        timeMin,
        timeMax,
      );
      for (const item of items) {
        // Zenflow's own events come back through the sync, and free time is not busy.
        if (
          item.status === "cancelled" ||
          item.transparency === "transparent" ||
          item.extendedProperties?.private?.zf
        )
          continue;
        const block = busyBlock(item);
        if (!block) continue;
        wanted.set(`google:${calendar.id}:${item.id}`, {
          title: (item.summary || "Busy").slice(0, TITLE_MAX),
          ...block,
        });
      }
    }

    const existing = await this.prisma.session.findMany({
      where: { userId, source: "GOOGLE" },
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
                source: "GOOGLE",
                type: "DND",
                title: block.title,
                durationMinutes: block.durationMinutes,
                scheduledStartTime: block.start,
              },
            }),
      );
    }

    // Gone from Google (or moved out of the window): hide the block, keep the row.
    for (const row of existing) {
      if (
        row.deleted ||
        wanted.has(row.externalKey ?? "") ||
        !row.scheduledStartTime ||
        row.scheduledStartTime < timeMin ||
        row.scheduledStartTime > timeMax
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
