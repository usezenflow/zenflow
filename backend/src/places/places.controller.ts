import { BadRequestException, Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { CookieAuthGuard } from "../auth/guards";
import { PlacesService, type RouteProfile } from "./places.service";

const PROFILES: readonly RouteProfile[] = ["car", "bike", "foot"];

function parsePoint(value: string | undefined): { lat: number; lng: number } {
  const [lat, lng] = (value ?? "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new BadRequestException("Expected lat,lng.");
  }
  return { lat, lng };
}

@Controller("places")
@UseGuards(CookieAuthGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get("search")
  async search(@Query("q") q = "", @Res({ passthrough: true }) res: Response) {
    // The app aborts a stale keystroke; its queued lookup is then dropped.
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) gone.abort();
    });
    const places = await this.places.search(q.slice(0, 120), gone.signal);
    return { success: true, message: `Found ${places.length} places`, data: { places } };
  }

  /** Route between two points in Lam Dong. `route` is `null` when there is none. */
  @Get("route")
  async route(
    @Query("profile") profile = "car",
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    if (!PROFILES.includes(profile as RouteProfile)) {
      throw new BadRequestException("Unknown profile.");
    }
    const route = await this.places.route(profile as RouteProfile, parsePoint(from), parsePoint(to));
    return { success: true, message: route ? "Found a route" : "No route", data: { route } };
  }
}
