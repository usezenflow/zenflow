import { Injectable, Logger } from "@nestjs/common";
import {
  resolveCampusPlace,
  routeMinutes,
  routeSeconds,
  vehicleFor,
} from "@zenflow/shared";
import { MAX_COMMUTE_MINUTES } from "../common/constants";
import { PlacesService } from "../places/places.service";
import { PrismaService } from "../prisma/prisma.service";

/** Sessions that ended more than this long ago keep what they have. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

interface Point {
  lat: number;
  lng: number;
}

/**
 * Gives sessions that have a place but no commute of their own the student's
 * home as the start and the travel time for their vehicle (ADR-0029). Rows it
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
  async apply(userId: string, now: Date = new Date()): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        homeLocation: true,
        homeLat: true,
        homeLng: true,
        defaultTransport: true,
      },
    });
    if (!user) return 0;
    const since = new Date(now.getTime() - LOOKBACK_MS);

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
    const vehicle = vehicleFor(user.defaultTransport);
    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        deleted: false,
        location: { not: null },
        scheduledStartTime: { gte: since },
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
      },
      take: BATCH,
    });

    // One route per distinct destination: a timetable repeats a few buildings.
    const byDestination = new Map<string, { to: Point; ids: string[] }>();
    for (const row of rows) {
      const to = this.destinationOf(row);
      if (!to) continue;
      const key = `${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
      const group = byDestination.get(key) ?? { to, ids: [] };
      group.ids.push(row.id);
      byDestination.set(key, group);
    }

    let changed = 0;
    for (const { to, ids } of byDestination.values()) {
      const route = await this.places.route(vehicle.profile, home, to);
      if (!route) continue;
      const minutes = Math.min(
        MAX_COMMUTE_MINUTES,
        routeMinutes(routeSeconds(route, vehicle)),
      );
      const result = await this.prisma.session.updateMany({
        where: { id: { in: ids }, userId },
        data: {
          originLocation: user.homeLocation,
          originLat: home.lat,
          originLng: home.lng,
          commuteMinutes: minutes,
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
