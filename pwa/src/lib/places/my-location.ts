import type { MapPoint } from "@/lib/places/campus-map";

export type MyLocation = { ok: true; point: MapPoint } | { ok: false; reason: "denied" | "unavailable" };

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
      { timeout: 10000, maximumAge: 60000 },
    );
  });
}
