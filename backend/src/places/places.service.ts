import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CAMPUS_ENTRIES,
  onCampus,
  routeMinutes,
  routeSeconds,
  vehicleFor,
  type CommuteRoute,
  type CommuteTransport,
  type RouteLeg,
} from "@zenflow/shared";
import type { Cache } from "cache-manager";

export interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface NominatimRow {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
}

export type RouteProfile = "car" | "bike" | "foot";

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** `[lng, lat]` pairs along the route. */
  coordinates: [number, number][];
}

interface OsrmBody {
  code?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
}

/** Lam Dong province, `west,north,east,south`. Search and routes stay inside it. */
export const LAM_DONG_VIEWBOX = "107.3,12.3,108.9,11.1";
const LAM_DONG = { west: 107.3, north: 12.3, east: 108.9, south: 11.1 };
/** Dalat University: results sort by distance to it. */
const DLU = { lat: 11.9558, lng: 108.4437 };

export function inLamDong(lat: number, lng: number): boolean {
  return (
    lat <= LAM_DONG.north &&
    lat >= LAM_DONG.south &&
    lng >= LAM_DONG.west &&
    lng <= LAM_DONG.east
  );
}

/** "Phan Đình Phùng" to "phan dinh phung". */
function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function distanceToDlu(lat: number, lng: number): number {
  const dLat = lat - DLU.lat;
  const dLng = (lng - DLU.lng) * Math.cos((DLU.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A genuine "nothing here" is kept briefly: OpenStreetMap gains places, and a failure is never cached. */
const EMPTY_CACHE_TTL_MS = 5 * 60 * 1000;
const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000;
/** Nominatim's public usage policy allows one request per second. */
const MIN_GAP_MS = 1100;
const RESULT_LIMIT = 6;
/** Rows asked of Nominatim: the nearest few of these are kept, so a far hit cannot crowd out a near one. */
const FETCH_LIMIT = 15;
/** Da Lat city, `west,north,east,south`: searched first so the nearest matches win. */
const DALAT_VIEWBOX = "108.3,12.05,108.6,11.85";

/** A stop this close to the destination needs no walk. */
const ARRIVED_METERS = 40;

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** The route timed for the vehicle that covers it. */
function toLeg(
  route: RouteResult,
  vehicle: ReturnType<typeof vehicleFor>,
): RouteLeg {
  const durationSeconds = routeSeconds(route, vehicle);
  return {
    distanceMeters: route.distanceMeters,
    durationSeconds,
    minutes: routeMinutes(durationSeconds),
    coordinates: route.coordinates,
  };
}

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly baseUrl: string;
  private readonly routingUrl: string;
  private lastCall = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    config: ConfigService,
  ) {
    this.baseUrl =
      config.get<string>("NOMINATIM_URL") ??
      "https://nominatim.openstreetmap.org";
    this.routingUrl =
      config.get<string>("ROUTING_URL") ?? "https://routing.openstreetmap.de";
  }

  /**
   * Searches OpenStreetMap near Vietnam. Cached by query; calls are spaced out.
   * A query whose caller has gone is dropped before it reaches the upstream, and
   * an upstream failure returns nothing without being cached.
   */
  async search(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 3) return [];
    const key = `places:search:${q}`;
    const hit = await this.cache.get<PlaceResult[]>(key);
    if (hit) return hit;
    try {
      const results = await this.enqueue(() => this.fetchRows(q), signal);
      await this.cache.set(
        key,
        results,
        results.length > 0 ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS,
      );
      return results;
    } catch (error) {
      if (!signal?.aborted)
        this.logger.warn(`Place search failed: ${(error as Error).message}`);
      return [];
    }
  }

  /** The route between two points inside Lam Dong, or `null` when there is none. */
  async route(
    profile: RouteProfile,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RouteResult | null> {
    if (!inLamDong(from.lat, from.lng) || !inLamDong(to.lat, to.lng))
      return null;
    const round = (n: number) => n.toFixed(4);
    const key = `places:route:${profile}:${round(from.lat)},${round(from.lng)}:${round(to.lat)},${round(to.lng)}`;
    const hit = await this.cache.get<RouteResult | null>(key);
    if (hit) return hit;
    const result = await this.enqueue(() => this.fetchRoute(profile, from, to));
    if (result) await this.cache.set(key, result, ROUTE_CACHE_TTL_MS);
    return result;
  }

  /**
   * The trip from `from` to `to` for one vehicle. A ridden trip to the campus
   * ends at the gate or parking with the shorter ride plus walk, since students
   * may not ride inside. `null` when no route exists.
   */
  async commute(
    transport: CommuteTransport,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<CommuteRoute | null> {
    const vehicle = vehicleFor(transport);
    const foot = vehicleFor("WALK");
    const walkAll = vehicle.id === "WALK" || onCampus(from);
    if (walkAll || !onCampus(to)) {
      const route = await this.route(
        walkAll ? foot.profile : vehicle.profile,
        from,
        to,
      );
      if (!route) return null;
      const leg = toLeg(route, walkAll ? foot : vehicle);
      return {
        minutes: leg.minutes,
        distanceMeters: leg.distanceMeters,
        ride: walkAll ? null : leg,
        walk: walkAll ? leg : null,
        entry: null,
      };
    }

    let best: CommuteRoute | null = null;
    let bestSeconds = Infinity;
    for (const entry of CAMPUS_ENTRIES) {
      const rideRoute = await this.route(vehicle.profile, from, entry);
      if (!rideRoute) continue;
      const ride = toLeg(rideRoute, vehicle);
      // Stopping at the destination itself needs no walk.
      const arrived = metersBetween(entry, to) < ARRIVED_METERS;
      const walkRoute = arrived
        ? null
        : await this.route(foot.profile, entry, to);
      if (!arrived && !walkRoute) continue;
      const walk = walkRoute ? toLeg(walkRoute, foot) : null;
      const seconds = ride.durationSeconds + (walk?.durationSeconds ?? 0);
      if (seconds >= bestSeconds) continue;
      bestSeconds = seconds;
      best = {
        minutes: routeMinutes(seconds),
        distanceMeters: ride.distanceMeters + (walk?.distanceMeters ?? 0),
        ride,
        walk,
        entry: { name: entry.name, lat: entry.lat, lng: entry.lng },
      };
    }
    if (best) return best;

    // No gate is reachable on foot: ride all the way.
    const direct = await this.route(vehicle.profile, from, to);
    if (!direct) return null;
    const ride = toLeg(direct, vehicle);
    return {
      minutes: ride.minutes,
      distanceMeters: ride.distanceMeters,
      ride,
      walk: null,
      entry: null,
    };
  }

  private async fetchRoute(
    profile: RouteProfile,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RouteResult | null> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = new URL(
      `/routed-${profile}/route/v1/driving/${coords}`,
      this.routingUrl,
    );
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    try {
      await this.pace();
      const response = await fetch(url, {
        headers: { "User-Agent": "Zenflow/1.0 (https://usezenflow.com)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`routing ${response.status}`);
      const body = (await response.json()) as OsrmBody;
      const route = body.code === "Ok" ? body.routes?.[0] : undefined;
      if (!route) return null;
      return {
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        coordinates: route.geometry.coordinates,
      };
    } catch (error) {
      this.logger.warn(`Route failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Runs jobs one at a time. A job whose caller has gone is skipped. */
  private enqueue<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const run = this.queue.then(() => {
      signal?.throwIfAborted();
      return job();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Waits out the gap since the last upstream call. Jobs are serial, so calls never overlap. */
  private async pace(): Promise<void> {
    const wait = this.lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCall = Date.now();
  }

  /** Tries the query as typed, then without diacritics. Each pass widens from the box to Vietnam. */
  private async fetchRows(q: string): Promise<PlaceResult[]> {
    const plain = stripDiacritics(q);
    for (const text of plain === q ? [q] : [q, plain]) {
      for (const box of [DALAT_VIEWBOX, LAM_DONG_VIEWBOX]) {
        const inside = await this.queryNominatim(text, box, true);
        if (inside.length > 0) return inside;
      }
      // Home addresses are often missing inside the box; widen to Vietnam and keep Lam Dong hits.
      const wide = (
        await this.queryNominatim(text, LAM_DONG_VIEWBOX, false)
      ).filter((place) => inLamDong(place.lat, place.lng));
      if (wide.length > 0) return wide;
    }
    return [];
  }

  private async queryNominatim(
    q: string,
    viewbox: string,
    bounded: boolean,
  ): Promise<PlaceResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(FETCH_LIMIT));
    url.searchParams.set("countrycodes", "vn");
    url.searchParams.set("viewbox", viewbox);
    url.searchParams.set("bounded", bounded ? "1" : "0");
    url.searchParams.set("accept-language", "vi,en");
    await this.pace();
    const response = await fetch(url, {
      headers: { "User-Agent": "Zenflow/1.0 (https://usezenflow.com)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`nominatim ${response.status}`);
    const rows = (await response.json()) as NominatimRow[];
    return rows
      .map((row) => ({
        name: row.name || row.display_name.split(",")[0],
        address: row.display_name,
        lat: Number(row.lat),
        lng: Number(row.lon),
      }))
      .sort((a, b) => distanceToDlu(a.lat, a.lng) - distanceToDlu(b.lat, b.lng))
      .slice(0, RESULT_LIMIT);
  }
}
