import { useEffect, useMemo, useRef, useState } from "react";
import { Footprints, MapPin } from "lucide-react";
import { resolveCampusPlace } from "@zenflow/core";
import { VEHICLES, vehicleFor, type CommuteRoute, type CommuteTransport } from "@zenflow/shared";
import { fetchCommute, updateTravelSettings } from "@/api/places";
import { CampusMap } from "@/components/places/campus-map";
import { PlacePalette } from "@/components/places/place-palette";
import { VEHICLE_ICONS } from "@/components/places/vehicle-icons";
import { VehicleChip } from "@/components/places/vehicle-chip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserStore } from "@/hooks/use-user-store";
import { errorToast } from "@/lib/toast";
import { t, useLanguage } from "@/lib/i18n";
import type { MapPoint } from "@/lib/places/campus-map";
import { CAMPUS_CENTER, homeStop, stopFromText, type LocationValue, type Stop } from "@/lib/places/location";
import { inLamDong, routeKilometres } from "@/lib/places/route";
import { useMyLocationStop } from "@/lib/places/use-my-location-stop";
import { cn } from "@/lib/utils";

export interface PlacePickerProps {
  value: LocationValue;
  /** Fires on Done only. Closing the planner any other way keeps `value`. */
  onChange: (value: LocationValue) => void;
  /** The destination is fixed (a synced session); only the start can change. */
  destinationLocked?: boolean;
  /** The planner is shown while open. The caller owns the trigger. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When the trip starts, as an ISO instant. Unset, the trip is timed from now. */
  at?: string | null;
}

type Field = "from" | "to";

/**
 * The route planner for a location: a start, a destination on the map, the
 * vehicle, and the trip time. Opened by the caller.
 */
export function PlacePicker({ value, onChange, destinationLocked = false, open, onOpenChange, at = null }: PlacePickerProps) {
  useLanguage();
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        data-testid="session.location.planner"
        className={cn("gap-0 p-0", isMobile ? "h-[90dvh]" : "w-full sm:max-w-2xl")}
      >
        <Planner
          initial={value}
          destinationLocked={destinationLocked}
          at={at}
          onDone={(next) => {
            onChange(next);
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/** One line of the route card: a marker and the stop's name, or a prompt to add it. */
function StopRow({
  field,
  value,
  placeholder,
  onPress,
}: {
  field: Field;
  value: string;
  placeholder: string;
  /** Omitted when the stop cannot be changed. */
  onPress?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`session.location.${field}`}
      disabled={!onPress}
      onClick={onPress}
      className="flex h-12 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent"
    >
      <span className="flex w-5 shrink-0 items-center justify-center">
        {field === "from" ? (
          <span className="size-3 rounded-full border-[3px] border-primary" />
        ) : (
          <MapPin className="size-[18px] text-primary" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-base", !value && "text-muted-foreground")}>
        {value || placeholder}
      </span>
    </button>
  );
}

function Planner({
  initial,
  onDone,
  destinationLocked,
  at,
}: {
  initial: LocationValue;
  onDone: (value: LocationValue) => void;
  destinationLocked: boolean;
  at: string | null;
}) {
  useLanguage();
  const user = useUserStore((s) => s.user);
  const home = homeStop(user);
  const [to, setTo] = useState<Stop>({ text: initial.text, point: initial.point });
  // A session with no start of its own begins at home, so the student sets it once in settings.
  const [from, setFrom] = useState<Stop>(() =>
    initial.originPoint
      ? { text: initial.origin, point: initial.originPoint }
      : initial.origin.trim() === "" && home
        ? home
        : stopFromText(initial.origin),
  );
  /** The stop being searched, or null while the map is showing. */
  const [searching, setSearching] = useState<Field | null>(null);
  /** The stop the next map click pins. */
  const [pinning, setPinning] = useState<Field>(destinationLocked ? "from" : "to");
  const [vehicleId, setVehicleId] = useState<CommuteTransport>(vehicleFor(user?.defaultTransport).id);
  const [commute, setCommute] = useState<CommuteRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeFailed, setRouteFailed] = useState(false);
  const { locating, note, locate, clear } = useMyLocationStop();

  const vehicle = vehicleFor(vehicleId);
  const start = from.point;
  const destination = useMemo(() => to.point ?? resolveCampusPlace(to.text), [to.point, to.text]);
  const outside = !!start && !!destination && !(inLamDong(start) && inLamDong(destination));

  // The trip key compares values, so the trip saved on open is recognised when nothing moved.
  const tripKey = `${start ? `${start.lat},${start.lng}` : ""}|${destination ? `${destination.lat},${destination.lng}` : ""}|${vehicle.id}`;
  const initialTripKey = useRef(tripKey);

  useEffect(() => {
    setRouteFailed(false);
    setCommute(null);
    if (!start || !destination) {
      setRouting(false);
      return;
    }
    const controller = new AbortController();
    setRouting(true);
    fetchCommute(vehicle.id, start, destination, controller.signal, at)
      .then((next) => setCommute(next))
      .catch(() => {
        if (controller.signal.aborted) return;
        setRouteFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouting(false);
      });
    return () => controller.abort();
  }, [start, destination, vehicle.id, at]);

  const closePalette = () => {
    setSearching(null);
    clear();
  };

  const choose = (stop: Stop) => {
    if (searching === "from") setFrom(stop);
    else setTo(stop);
    closePalette();
  };

  const takeMyLocation = async () => {
    const point = await locate();
    if (!point) return;
    setFrom({ text: t("My location"), point });
    closePalette();
  };

  const pickVehicle = (id: CommuteTransport) => {
    setVehicleId(id);
    if (user && user.defaultTransport !== id) {
      updateTravelSettings({ defaultTransport: id })
        .then((updated) => useUserStore.getState().setUser(updated))
        .catch(() => errorToast(t("Could not save. Try again.")));
    }
  };

  const onPick = (picked: MapPoint) => {
    const current = pinning === "from" ? from : to;
    const stop = { text: current.text.trim() || t("Pinned location"), point: picked };
    if (pinning === "from") setFrom(stop);
    else setTo(stop);
  };

  const minutes = commute?.minutes ?? null;
  const ride = useMemo(() => commute?.ride?.coordinates ?? null, [commute]);
  const walk = useMemo(() => commute?.walk?.coordinates ?? null, [commute]);
  // Done with both ends as they were keeps the saved time.
  const unchanged = tripKey === initialTripKey.current;
  const done = () =>
    onDone({
      text: to.text.trim(),
      point: to.point,
      origin: from.text.trim(),
      originPoint: from.point,
      commuteMinutes: minutes ?? (unchanged ? initial.commuteMinutes : null),
    });
  const Vehicle = VEHICLE_ICONS[vehicleId];

  const summary = (() => {
    if (!start || !destination) return null;
    if (!routing && !commute) {
      const title = routeFailed
        ? t("Couldn't load the route. Try again later.")
        : outside
          ? t("You're outside Da Lat")
          : t("No route found");
      return (
        <p data-testid="session.location.summary" className={cn("rounded-xl bg-muted px-3 py-2 text-sm", routeFailed ? "text-destructive" : "text-muted-foreground")}>
          {title}
        </p>
      );
    }
    if (!commute || minutes === null) {
      return (
        <div data-testid="session.location.summary" className="flex items-center gap-3 px-1 pt-1">
          <Vehicle className="size-5 text-primary" />
          <span className="text-[15px] font-medium text-muted-foreground">{t("Finding a route…")}</span>
        </div>
      );
    }
    return (
      <div data-testid="session.location.summary" className="flex items-center gap-3 px-1 pt-1">
        <Vehicle className="size-5 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[17px] font-bold">
            {t("{minutes} min", { minutes: String(minutes) })}
            <span className="ml-2 text-[15px] font-medium text-muted-foreground">
              {t("{km} km", { km: routeKilometres(commute.distanceMeters) })}
            </span>
          </p>
          {commute.ride && commute.walk && commute.entry ? (
            <div data-testid="session.location.legs" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
              <Vehicle className="size-3.5" />
              <span>{t("{minutes} min", { minutes: String(commute.ride.minutes) })}</span>
              <span className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto">
                <Footprints className="size-3.5 shrink-0" />
                <span>
                  {t("{minutes} min from {gate}", { minutes: String(commute.walk.minutes), gate: commute.entry.name })}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pr-14 pt-5">
        <SheetTitle className="text-[19px] font-bold tracking-tight">{t("Location")}</SheetTitle>
        <SheetDescription className="sr-only">{t("Pick the start and the destination")}</SheetDescription>
        <Button type="button" data-testid="session.location.done" onClick={done}>
          {t("Done")}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-t-3xl">
        <div className="absolute inset-0">
          <CampusMap
            fill
            point={destination ?? CAMPUS_CENTER}
            start={start}
            route={ride}
            walk={walk}
            name={to.text}
            onPick={onPick}
          />
        </div>

        <div className="absolute inset-x-5 top-3 overflow-hidden rounded-2xl border border-border bg-card">
          <StopRow
            field="from"
            value={from.text}
            placeholder={t("Add start")}
            onPress={() => {
              setPinning("from");
              setSearching("from");
            }}
          />
          <div className="ml-11 h-px bg-border" />
          <StopRow
            field="to"
            value={to.text}
            placeholder={t("Add destination")}
            onPress={
              destinationLocked
                ? undefined
                : () => {
                    setPinning("to");
                    setSearching("to");
                  }
            }
          />
        </div>

        <div className="absolute inset-x-5 bottom-4 flex flex-col gap-2 rounded-3xl border border-border bg-card p-3">
          <div role="radiogroup" data-testid="session.location.vehicles" className="flex gap-2">
            {VEHICLES.map((item) => (
              <VehicleChip
                key={item.id}
                id={item.id}
                label={t(item.labelKey)}
                selected={item.id === vehicleId}
                onPress={() => pickVehicle(item.id)}
              />
            ))}
          </div>
          {summary}
        </div>
      </div>

      <PlacePalette
        open={searching !== null}
        onOpenChange={(open) => {
          if (!open) closePalette();
        }}
        title={searching === "from" ? t("Starting point") : t("To")}
        placeholder={t("Search places")}
        onChoose={choose}
        onPickOnMap={closePalette}
        onMyLocation={searching === "from" ? () => void takeMyLocation() : undefined}
        home={searching === "from" ? home : null}
        locating={locating}
        locationNote={note}
      />
    </div>
  );
}
