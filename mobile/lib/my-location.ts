import * as Location from "expo-location";
import type { MapPoint } from "@/lib/campus-map";

export type MyLocationFailure = "denied" | "blocked" | "services-off" | "unavailable";

export type MyLocation = { ok: true; point: MapPoint } | { ok: false; reason: MyLocationFailure };

const FIX_TIMEOUT_MS = 8000;

function toPoint(coords: { latitude: number; longitude: number }): MapPoint {
  return { lat: coords.latitude, lng: coords.longitude };
}

/**
 * Asks for permission when needed, then reads the current position once.
 * `blocked` means the system will not ask again, so only settings can help.
 * A slow or failed fresh fix falls back to the last known one.
 */
export async function getMyLocation(): Promise<MyLocation> {
  try {
    const { granted, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return { ok: false, reason: canAskAgain ? "denied" : "blocked" };
    if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: "services-off" };
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]).catch(() => null);
    const fix = fresh ?? (await Location.getLastKnownPositionAsync().catch(() => null));
    return fix ? { ok: true, point: toPoint(fix.coords) } : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
