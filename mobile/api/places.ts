import type { Route, RouteProfile } from "@/lib/campus-route";
import { routeMinutes, routeSeconds, vehicleFor, type CommuteRoute, type CommuteTransport } from "@zenflow/shared";
import { api } from "./base";

export interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** `GET /places/search`: OpenStreetMap places in Vietnam. */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const { data } = await api.get("/places/search", { params: { q }, signal });
  return data.data.places;
}

const PUBLIC_ROUTING_URL = "https://routing.openstreetmap.de";

interface OsrmBody {
  code?: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
}

/** Asks the public router directly, for a backend that has no route endpoint yet. */
async function fetchPublicRoute(
  profile: RouteProfile,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<Route | null> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${PUBLIC_ROUTING_URL}/routed-${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`routing ${response.status}`);
  const body = (await response.json()) as OsrmBody;
  const route = body.code === "Ok" ? body.routes?.[0] : undefined;
  return route
    ? { distanceMeters: route.distance, durationSeconds: route.duration, coordinates: route.geometry.coordinates }
    : null;
}

/**
 * The route between two points: `null` when there is none, a throw when the
 * service could not be reached. Falls back to the public router when the API
 * has no `/places/route`.
 */
export async function fetchRoute(
  profile: RouteProfile,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<Route | null> {
  try {
    const { data } = await api.get("/places/route", {
      params: { profile, from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` },
      signal,
    });
    return data.data.route;
  } catch (error) {
    if (signal?.aborted) throw error;
    return fetchPublicRoute(profile, from, to, signal);
  }
}

/**
 * The trip for one vehicle: ridden to the gate or parking with the shorter total,
 * then on foot. `null` when there is none, a throw when the service could not be
 * reached. An API without `/places/commute` gets a plain ride instead.
 */
export async function fetchCommute(
  transport: CommuteTransport,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<CommuteRoute | null> {
  try {
    const { data } = await api.get("/places/commute", {
      params: { transport, from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` },
      signal,
    });
    return data.data.commute;
  } catch (error) {
    if (signal?.aborted) throw error;
    const vehicle = vehicleFor(transport);
    const route = await fetchRoute(vehicle.profile, from, to, signal);
    if (!route) return null;
    const durationSeconds = routeSeconds(route, vehicle);
    const ride = {
      distanceMeters: route.distanceMeters,
      durationSeconds,
      minutes: routeMinutes(durationSeconds),
      coordinates: route.coordinates,
    };
    return { minutes: ride.minutes, distanceMeters: ride.distanceMeters, ride, walk: null, entry: null };
  }
}
