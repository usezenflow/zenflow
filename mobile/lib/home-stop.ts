import type { Stop } from "@/components/calendar/place-palette";

/** The home saved in settings as a stop, or null when none is set. */
export function homeStop(
  user: { homeLocation: string | null; homeLat: number | null; homeLng: number | null } | null | undefined,
): Stop | null {
  if (!user?.homeLocation || user.homeLat == null || user.homeLng == null) return null;
  return { text: user.homeLocation, point: { lat: user.homeLat, lng: user.homeLng } };
}
