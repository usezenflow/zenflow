import { locale } from "@/lib/i18n";
import type { MapPoint } from "@/lib/places/campus-map";

/** Lam Dong province: the router only serves points inside it. */
export function inLamDong(point: MapPoint): boolean {
  return point.lat <= 12.3 && point.lat >= 11.1 && point.lng >= 107.3 && point.lng <= 108.9;
}

/** Kilometres to one decimal place. */
export function routeKilometres(meters: number): string {
  return (meters / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

