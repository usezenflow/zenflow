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
