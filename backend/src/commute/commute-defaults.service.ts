import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_VEHICLE,
  rideInsideAllowed,
  resolveCampusPlace,
  type CommuteTransport,
} from "@zenflow/shared";
import { MAX_COMMUTE_MINUTES } from "../common/constants";
import { PlacesService } from "../places/places.service";
import { PrismaService } from "../prisma/prisma.service";

const BATCH = 500;

interface Point {
  lat: number;
  lng: number;
}

/**
 * Gives sessions that have a place but no commute of their own the student's
 * home as the start and the travel time for their vehicle, riding to the
 * nearest gate and walking in (ADR-0029, ADR-0031). Rows it
 * filled are marked `commuteAuto`, so a new home or vehicle redoes them; a
 * commute the student edited is never touched.
 */
@Injectable()
export class CommuteDefaultsService {
  private readonly logger = new Logger(CommuteDefaultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly places: PlacesService,
  ) {}

  /** Best-effort and never throws: callers run it after their own work is done. */
  async applyQuietly(userId: string): Promise<void> {
    try {
      await this.apply(userId);
    } catch (error) {
      this.logger.warn(
        `Commute defaults failed for ${userId}: ${(error as Error).message}`,
      );
    }
  }

  /** Rows changed. */
  async apply(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        homeLocation: true,
        homeLat: true,
        homeLng: true,
        defaultTransport: true,
        timezone: true,
      },
    });
    if (!user) return 0;

    if (user.homeLat === null || user.homeLng === null || !user.homeLocation) {
      // No home: take back what it filled so nothing keeps a stale buffer.
      const cleared = await this.prisma.session.updateMany({
        where: { userId, commuteAuto: true },
        data: {
          originLocation: null,
          originLat: null,
          originLng: null,
          commuteMinutes: null,
          commuteAuto: false,
        },
      });
      return cleared.count;
    }

    const home: Point = { lat: user.homeLat, lng: user.homeLng };
    const transport = user.defaultTransport ?? DEFAULT_VEHICLE;

    // Every session the student has, past ones included, a page at a time.
    // Rows that cannot be filled stay selected, so the cursor moves past them.
    let changed = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.session.findMany({
        where: {
          userId,
          deleted: false,
          location: { not: null },
          OR: [
            { commuteAuto: true },
            { originLocation: null, commuteMinutes: null },
          ],
        },
        select: {
          id: true,
          location: true,
          locationLat: true,
          locationLng: true,
          scheduledStartTime: true,
        },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      changed += await this.fill(
        userId,
        user.homeLocation,
        home,
        transport,
        user.timezone,
        rows,
      );
      if (rows.length < BATCH) break;
    }
    return changed;
  }

  private async fill(
    userId: string,
    homeName: string,
    home: Point,
    transport: CommuteTransport,
    timezone: string,
    rows: {
      id: string;
      location: string | null;
      locationLat: number | null;
      locationLng: number | null;
      scheduledStartTime: Date | null;
    }[],
  ): Promise<number> {
    // One trip per distinct destination and riding rule: a timetable repeats a few buildings.
    const byDestination = new Map<
      string,
      { to: Point; rideInside: boolean; ids: string[] }
    >();
    for (const row of rows) {
      const to = this.destinationOf(row);
      if (!to) continue;
      const rideInside = rideInsideAllowed(row.scheduledStartTime, timezone);
      const key = `${to.lat.toFixed(4)},${to.lng.toFixed(4)},${rideInside}`;
      const group = byDestination.get(key) ?? { to, rideInside, ids: [] };
      group.ids.push(row.id);
      byDestination.set(key, group);
    }

    let changed = 0;
    for (const { to, rideInside, ids } of byDestination.values()) {
      const commute = await this.places.commute(
        transport,
        home,
        to,
        rideInside,
      );
      if (!commute) continue;
      const result = await this.prisma.session.updateMany({
        where: { id: { in: ids }, userId },
        data: {
          originLocation: homeName,
          originLat: home.lat,
          originLng: home.lng,
          commuteMinutes: Math.min(MAX_COMMUTE_MINUTES, commute.minutes),
          commuteAuto: true,
        },
      });
      changed += result.count;
    }
    return changed;
  }

  /** The pinned point, else the campus place the name means. */
  private destinationOf(row: {
    location: string | null;
    locationLat: number | null;
    locationLng: number | null;
  }): Point | null {
    if (row.locationLat !== null && row.locationLng !== null)
      return { lat: row.locationLat, lng: row.locationLng };
    const place = row.location ? resolveCampusPlace(row.location) : null;
    return place ? { lat: place.lat, lng: place.lng } : null;
  }
}
