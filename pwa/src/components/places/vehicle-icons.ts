import { Bike, Car, Footprints, Motorbike, type LucideIcon } from "lucide-react";
import type { CommuteTransport } from "@zenflow/shared";

/** One icon per way of getting to campus. */
export const VEHICLE_ICONS: Record<CommuteTransport, LucideIcon> = {
  MOTORCYCLE: Motorbike,
  CAR: Car,
  BIKE: Bike,
  WALK: Footprints,
};
