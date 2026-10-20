import type { CommuteTransport } from "@zenflow/shared";
import { VEHICLE_ICONS } from "@/components/places/vehicle-icons";
import { cn } from "@/lib/utils";

/** One vehicle: an icon over its name. */
export function VehicleChip({
  id,
  label,
  selected,
  onPress,
}: {
  id: CommuteTransport;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const Icon = VEHICLE_ICONS[id];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`session.location.vehicle.${id}`}
      onClick={onPress}
      className={cn(
        "flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-muted text-muted-foreground transition-colors",
        selected && "border-primary/50 bg-primary/15 text-primary",
      )}
    >
      <Icon className="size-5" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
