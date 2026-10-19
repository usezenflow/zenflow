export {
  DEFAULT_VEHICLE,
  VEHICLES,
  routeMinutes,
  routeSeconds,
  vehicleFor,
  type RouteProfile,
  type Vehicle,
} from "@zenflow/shared";

export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  /** `[lng, lat]` pairs along the route. */
  coordinates: [number, number][];
}

/** Kilometres to one decimal place. */
export function routeKilometres(meters: number): string {
  return (meters / 1000).toFixed(1);
}
