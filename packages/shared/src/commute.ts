import type { CommuteTransport } from "./user";

/** Routing profiles the backend `GET /places/route` serves. */
export type RouteProfile = "car" | "bike" | "foot";

export interface Vehicle {
  id: CommuteTransport;
  profile: RouteProfile;
  /** Town speed in km/h used for the time. `null` takes the router's own time. */
  kmh: number | null;
  labelKey: string;
}

/** Motorcycle first: it is the default. It follows car roads at motorbike pace. */
export const VEHICLES: readonly Vehicle[] = [
  { id: "MOTORCYCLE", profile: "car", kmh: 30, labelKey: "Motorcycle" },
  { id: "CAR", profile: "car", kmh: null, labelKey: "Car" },
  { id: "BIKE", profile: "bike", kmh: 15, labelKey: "Bike" },
  { id: "WALK", profile: "foot", kmh: 5, labelKey: "Walk" },
];

export const DEFAULT_VEHICLE: CommuteTransport = "MOTORCYCLE";

export function vehicleFor(id: CommuteTransport | null | undefined): Vehicle {
  return VEHICLES.find((vehicle) => vehicle.id === id) ?? VEHICLES[0];
}

/** Seconds the vehicle takes: the router's time for a car, distance at town speed otherwise. */
export function routeSeconds(
  route: { distanceMeters: number; durationSeconds: number },
  vehicle: Vehicle,
): number {
  if (vehicle.kmh === null) return route.durationSeconds;
  return (route.distanceMeters / 1000 / vehicle.kmh) * 3600;
}

/** Whole minutes, at least one. */
export function routeMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** One stretch of a trip, timed for the vehicle that covers it. */
export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
  /** Whole minutes, at least one. */
  minutes: number;
  /** `[lng, lat]` pairs along the leg. */
  coordinates: [number, number][];
}

/**
 * `data.commute` of `GET /places/commute`. A ridden trip to the campus stops at
 * the gate or parking with the shorter total and walks the rest, because
 * vehicles are not allowed inside.
 */
export interface CommuteRoute {
  /** Both legs together, whole minutes, at least one. */
  minutes: number;
  distanceMeters: number;
  /** Null when the trip is all on foot. */
  ride: RouteLeg | null;
  /** Null when the trip is all ridden or the stop is the destination. */
  walk: RouteLeg | null;
  /** Where the ride ends and the walk starts; null without a walk after a ride. */
  entry: { name: string; lat: number; lng: number } | null;
}
