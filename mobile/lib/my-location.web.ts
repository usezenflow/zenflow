import type { MapPoint } from "@/lib/campus-map";

export type MyLocationFailure = "denied" | "blocked" | "services-off" | "unavailable";

export type MyLocation = { ok: true; point: MapPoint } | { ok: false; reason: MyLocationFailure };

/** The browser asks for permission itself on the first read. */
export function getMyLocation(): Promise<MyLocation> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ ok: true, point: { lat: coords.latitude, lng: coords.longitude } }),
      (error) => resolve({ ok: false, reason: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { timeout: 10000 },
    );
  });
}
