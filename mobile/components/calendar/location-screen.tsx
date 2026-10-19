import { fetchRoute } from "@/api/places";
import { updateBasicInfo } from "@/api/users";
import { CampusMap } from "@/components/calendar/campus-map";
import { Bike, Car, Footprints, MapPin, Motorbike, type LucideIcon } from "@/components/Icons";
import { PlacePalette, type Stop } from "@/components/calendar/place-palette";
import { NoteScreen } from "@/components/tasks/note/description-field";
import { Notice } from "@/components/ui/notice";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useUserStore } from "@/hooks/use-user-store";
import { type Route, VEHICLES, routeKilometres, routeMinutes, routeSeconds, vehicleFor } from "@/lib/campus-route";
import type { MapPoint } from "@/lib/campus-map";
import { t } from "@/lib/i18n";
import { getMyLocation } from "@/lib/my-location";
import { cn } from "@/lib/utils";
import { CAMPUS_PLACES, resolveCampusPlace } from "@zenflow/core";
import type { CommuteTransport } from "@zenflow/shared";

const VEHICLE_ICONS: Record<CommuteTransport, LucideIcon> = {
  MOTORCYCLE: Motorbike,
  CAR: Car,
  BIKE: Bike,
  WALK: Footprints,
};
import { useEffect, useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface LocationValue {
  /** The destination, saved as the session's location. */
  text: string;
  /** Set for a place picked on the map or from search; campus names derive theirs. */
  point: MapPoint | null;
  /** Where the trip starts, saved as the session's origin. */
  origin: string;
  /** The start's map point; campus names derive theirs. */
  originPoint: MapPoint | null;
  /** Travel minutes each way for the chosen vehicle, or null when no route is known. */
  commuteMinutes: number | null;
}

type Field = "from" | "to";

/** Lam Dong province: the router only serves points inside it. */
function inLamDong(point: MapPoint): boolean {
  return point.lat <= 12.3 && point.lat >= 11.1 && point.lng >= 107.3 && point.lng <= 108.9;
}

/** The campus gate: where the map opens when nothing is picked. */
const CAMPUS_CENTER: MapPoint = CAMPUS_PLACES.find((place) => place.kind === "GATE") ?? CAMPUS_PLACES[0];

/** A saved campus name or code keeps its coordinates; other text has none. */
function stopFromText(text: string): Stop {
  const place = resolveCampusPlace(text);
  return { text, point: place ? { lat: place.lat, lng: place.lng } : null };
}

/** One line of the route card: a rail marker and the stop's name, or a prompt to add it. */
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
    <Pressable
      testID={`session.location.${field}`}
      accessibilityRole="button"
      accessibilityLabel={value || placeholder}
      disabled={!onPress}
      onPress={onPress}
      className="h-12 flex-row items-center gap-3 px-3 active:bg-muted/60"
    >
      <View className="w-5 items-center">
        {field === "from" ? (
          <View className="h-3 w-3 rounded-full border-[3px] border-primary" />
        ) : (
          <MapPin size={18} className="text-primary" />
        )}
      </View>
      <Text numberOfLines={1} className={cn("min-w-0 flex-1 text-[16px]", !value && "text-muted-foreground")}>
        {value || placeholder}
      </Text>
    </Pressable>
  );
}

/** One vehicle: an icon over its name. Same look as the app's other chips, readable in both themes. */
function VehicleChip({
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
    <Pressable
      testID={`session.location.vehicle.${id}`}
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      onPress={onPress}
      className={cn(
        "h-14 flex-1 items-center justify-center gap-1 rounded-2xl border border-border bg-muted",
        selected && "border-primary/50 bg-primary/15",
      )}
    >
      <Icon size={20} className={selected ? "text-primary" : "text-muted-foreground"} />
      <Text className={cn("text-[12px] font-medium", selected ? "text-primary" : "text-muted-foreground")}>
        {label}
      </Text>
    </Pressable>
  );
}

function Body({
  initial,
  onClose,
  destinationLocked,
}: {
  initial: LocationValue;
  onClose: (value: LocationValue) => void;
  destinationLocked: boolean;
}) {
  useLanguage();
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const [to, setTo] = useState<Stop>({ text: initial.text, point: initial.point });
  const [from, setFrom] = useState<Stop>(() =>
    initial.originPoint ? { text: initial.origin, point: initial.originPoint } : stopFromText(initial.origin),
  );
  /** The stop being searched, or null while the map is showing. */
  const [searching, setSearching] = useState<Field | null>(null);
  /** The stop the next map tap pins. */
  const [pinning, setPinning] = useState<Field>(destinationLocked ? "from" : "to");
  const [vehicleId, setVehicleId] = useState<CommuteTransport>(vehicleFor(user?.defaultTransport).id);
  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeFailed, setRouteFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [settingsNeeded, setSettingsNeeded] = useState(false);

  const vehicle = vehicleFor(vehicleId);
  const destination = to.point ?? resolveCampusPlace(to.text) ?? null;
  const start = from.point;
  const outside = !!start && !!destination && !(inLamDong(start) && inLamDong(destination));

  // The trail: from the start to the destination, drawn once both are known.
  const startKey = start ? `${start.lat},${start.lng}` : "";
  const endKey = destination ? `${destination.lat},${destination.lng}` : "";
  const tripKey = `${startKey}|${endKey}|${vehicle.profile}`;
  const initialTripKey = useRef(tripKey);
  useEffect(() => {
    setRouteFailed(false);
    if (!start || !destination) {
      setRoute(null);
      setRouting(false);
      return;
    }
    const controller = new AbortController();
    setRouting(true);
    fetchRoute(vehicle.profile, start, destination, controller.signal)
      .then((next) => setRoute(next))
      .catch(() => {
        if (controller.signal.aborted) return;
        setRoute(null);
        setRouteFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouting(false);
      });
    return () => controller.abort();
    // The points are rebuilt each render, so the effect keys on their values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, endKey, vehicle.profile]);

  const closePalette = () => {
    setSearching(null);
    setLocationNote(null);
    setSettingsNeeded(false);
  };

  const choose = (stop: Stop) => {
    if (searching === "from") setFrom(stop);
    else setTo(stop);
    closePalette();
  };

  const useMyLocation = async () => {
    setLocating(true);
    setLocationNote(null);
    setSettingsNeeded(false);
    const result = await getMyLocation();
    setLocating(false);
    if (result.ok) {
      setFrom({ text: t("My location"), point: result.point });
      closePalette();
      return;
    }
    setSettingsNeeded(result.reason === "blocked" || result.reason === "services-off");
    setLocationNote(
      result.reason === "denied" || result.reason === "blocked"
        ? t("Location is off. Enable it in settings.")
        : result.reason === "services-off"
          ? t("Turn on location services.")
          : t("Couldn't get your location."),
    );
  };

  const pickVehicle = (id: CommuteTransport) => {
    setVehicleId(id);
    if (user && user.defaultTransport !== id) {
      updateBasicInfo({ defaultTransport: id })
        .then((updated) => useUserStore.getState().updateUser(updated))
        .catch(() => {});
    }
  };

  const minutes = route ? routeMinutes(routeSeconds(route, vehicle)) : null;
  // Closing before the route loads, with both ends as they were, keeps the saved time.
  const unchanged = tripKey === initialTripKey.current;
  const done = () =>
    onClose({
      text: to.text.trim(),
      point: to.point,
      origin: from.text.trim(),
      originPoint: from.point,
      commuteMinutes: minutes ?? (unchanged ? initial.commuteMinutes : null),
    });
  const Vehicle = VEHICLE_ICONS[vehicleId];

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <Text className="text-[19px] font-bold tracking-tight">{t("Location")}</Text>
        <Pressable
          testID="session.location.done"
          accessibilityRole="button"
          onPress={done}
          className="h-9 items-center justify-center rounded-full bg-primary px-5 active:opacity-80"
        >
          <Text className="text-[14px] font-semibold text-primary-foreground">{t("Done")}</Text>
        </Pressable>
      </View>

      <View className="flex-1 overflow-hidden rounded-t-3xl">
        <View className="absolute inset-0">
          <CampusMap
            fill
            point={destination ?? CAMPUS_CENTER}
            start={start}
            route={route?.coordinates ?? null}
            name={to.text}
            onPick={(picked) => {
              const current = pinning === "from" ? from : to;
              const stop = { text: current.text.trim() || t("Pinned location"), point: picked };
              if (pinning === "from") setFrom(stop);
              else setTo(stop);
            }}
          />
        </View>

        <View className="absolute inset-x-5 top-3 overflow-hidden rounded-2xl border border-border bg-card">
          <StopRow
            field="from"
            value={from.text}
            placeholder={t("Add start")}
            onPress={() => {
              setPinning("from");
              setSearching("from");
            }}
          />
          <View className="ml-11 h-px bg-border" />
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
        </View>

        <View
          className="absolute inset-x-5 gap-2 rounded-3xl border border-border bg-card p-3"
          style={{ bottom: insets.bottom + 12 }}
        >
          <View testID="session.location.vehicles" className="flex-row gap-2">
            {VEHICLES.map((item) => (
              <VehicleChip
                key={item.id}
                id={item.id}
                label={t(item.labelKey)}
                selected={item.id === vehicleId}
                onPress={() => pickVehicle(item.id)}
              />
            ))}
          </View>
          {start && destination && !routing && !route ? (
            <Notice
              testID="session.location.summary"
              tone={routeFailed ? "error" : "info"}
              title={
                routeFailed
                  ? t("Couldn't load the route. Try again later.")
                  : outside
                    ? t("You're outside Da Lat")
                    : t("No route found")
              }
            />
          ) : start && destination ? (
            <View testID="session.location.summary" className="flex-row items-center gap-3 px-1 pt-1">
              <Vehicle size={20} className="text-primary" />
              {!route || minutes === null ? (
                <Text className="text-[15px] font-medium text-muted-foreground">{t("Finding a route…")}</Text>
              ) : (
                <Text className="text-[17px] font-bold">
                  {t("{minutes} min", { minutes: String(minutes) })}
                  <Text className="text-[15px] font-medium text-muted-foreground">
                    {`  ${routeKilometres(route.distanceMeters)} km`}
                  </Text>
                </Text>
              )}
            </View>
          ) : null}
        </View>
      </View>

      {searching && (
        <PlacePalette
          title={searching === "from" ? t("Starting point") : t("To")}
          placeholder={t("Search places")}
          onChoose={choose}
          onClose={closePalette}
          onPickOnMap={closePalette}
          onMyLocation={searching === "from" ? () => void useMyLocation() : undefined}
          locating={locating}
          locationNote={locationNote}
          settingsNeeded={settingsNeeded}
        />
      )}
    </View>
  );
}

/** Full-screen route planner: a vehicle, a start, a destination and the trail between them. */
export function LocationScreen({
  initial,
  onClose,
  destinationLocked = false,
}: {
  initial: LocationValue;
  onClose: (value: LocationValue) => void;
  /** The destination is fixed (a synced session); only the start can change. */
  destinationLocked?: boolean;
}) {
  const { height } = useWindowDimensions();
  // Done closes the screen, and unmounting its sheet then fires the sheet's
  // dismiss handler: only the first close counts, or it would restore `initial`.
  const closed = useRef(false);
  const finish = (value: LocationValue) => {
    if (closed.current) return;
    closed.current = true;
    onClose(value);
  };
  return (
    <NoteScreen height={height} onClose={() => finish(initial)}>
      <Body initial={initial} onClose={finish} destinationLocked={destinationLocked} />
    </NoteScreen>
  );
}
