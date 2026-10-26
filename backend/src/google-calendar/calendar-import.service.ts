import { Injectable } from "@nestjs/common";
import {
  BusyBlocksService,
  type BusyItem,
} from "../calendar-busy/busy-blocks.service";
import { GoogleCalendarClient } from "./google-calendar.client";

/**
 * Mirrors the user's other selected Google calendars into Zenflow as busy time.
 */
@Injectable()
export class CalendarImportService {
  constructor(
    private readonly busy: BusyBlocksService,
    private readonly client: GoogleCalendarClient,
  ) {}

  async importUser(
    userId: string,
    token: string,
    ownCalendarId: string,
    now = new Date(),
  ): Promise<void> {
    const { from, to } = this.busy.window(now);
    const calendars = (await this.client.listCalendars(token)).filter(
      (c) => c.selected && c.id !== ownCalendarId,
    );
    const items: BusyItem[] = [];
    for (const calendar of calendars) {
      const events = await this.client.listWindow(token, calendar.id, from, to);
      for (const event of events) {
        // Zenflow's own events come back through the sync, and free time is not busy.
        const start = event.start?.dateTime;
        const end = event.end?.dateTime;
        if (
          !start ||
          !end ||
          event.status === "cancelled" ||
          event.transparency === "transparent" ||
          event.extendedProperties?.private?.zf
        )
          continue;
        items.push({
          externalKey: `${calendar.id}:${event.id}`,
          title: event.summary ?? "",
          start: new Date(start),
          end: new Date(end),
        });
      }
    }
    await this.busy.replace(userId, "GOOGLE", items, now);
  }
}
