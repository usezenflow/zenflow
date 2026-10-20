import { CAMPUS_PLACES, resolveCampusPlace, type CampusPlace } from "@zenflow/core";
import type { User } from "@zenflow/shared";
import type { MapPoint } from "@/lib/places/campus-map";

/** One end of a trip: the name shown and the point it resolves to. */
export interface Stop {
  text: string;
  point: MapPoint | null;
}

/**
 * What the location picker edits. `text` and `point` are the session's location;
 * `origin` and `originPoint` are where the trip starts; `commuteMinutes` is one way.
 */
export interface LocationValue {
  text: string;
  point: MapPoint | null;
  origin: string;
  originPoint: MapPoint | null;
  commuteMinutes: number | null;
}

/** The campus gate: where the map opens when nothing is picked. */
export const CAMPUS_CENTER: CampusPlace = CAMPUS_PLACES.find((place) => place.kind === "GATE") ?? CAMPUS_PLACES[0];

/** A saved campus name or code keeps its coordinates; other text has none. */
export function stopFromText(text: string): Stop {
  const place = resolveCampusPlace(text);
  return { text, point: place ? { lat: place.lat, lng: place.lng } : null };
}

/** The home saved in settings as a stop, or null when none is set. */
export function homeStop(user: Pick<User, "homeLocation" | "homeLat" | "homeLng"> | null | undefined): Stop | null {
  if (!user?.homeLocation || user.homeLat == null || user.homeLng == null) return null;
  return { text: user.homeLocation, point: { lat: user.homeLat, lng: user.homeLng } };
}
