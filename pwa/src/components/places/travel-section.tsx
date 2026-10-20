import { useState } from "react";
import { ChevronRight, Home } from "lucide-react";
import { updateTravelSettings } from "@/api/places";
import { CampusMap } from "@/components/places/campus-map";
import { PlacePalette } from "@/components/places/place-palette";
import { VehicleChip } from "@/components/places/vehicle-chip";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserStore } from "@/hooks/use-user-store";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { CAMPUS_CENTER, homeStop, type Stop } from "@/lib/places/location";
import { useMyLocationStop } from "@/lib/places/use-my-location-stop";
import { VEHICLES, vehicleFor, type CommuteTransport } from "@zenflow/shared";
import { cn } from "@/lib/utils";
import type { MapPoint } from "@/lib/places/campus-map";

/** The home picker: a map to pin it, a search for it, and removal. Mounted on open, so its state starts fresh. */
function HomePicker({ initial, onDone }: { initial: Stop | null; onDone: (home: Stop | null) => void }) {
  useLanguage();
  const [home, setHome] = useState<Stop | null>(initial);
  const [searching, setSearching] = useState(false);
  const { locating, note, locate, clear } = useMyLocationStop();

  const closePalette = () => {
    setSearching(false);
    clear();
  };

  const takeMyLocation = async () => {
    const point = await locate();
    if (!point) return;
    setHome({ text: t("My location"), point });
    closePalette();
  };

  const onPick = (point: MapPoint) => setHome({ text: home?.text.trim() || t("Pinned location"), point });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pr-14 pt-5">
        <SheetTitle className="text-[19px] font-bold tracking-tight">{t("Home")}</SheetTitle>
        <SheetDescription className="sr-only">{t("Pin your home on the map")}</SheetDescription>
        <Button type="button" data-testid="settings.home.done" onClick={() => onDone(home)}>
          {t("Done")}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-t-3xl">
        <div className="absolute inset-0">
          <CampusMap fill point={home?.point ?? CAMPUS_CENTER} name={home?.text ?? ""} onPick={onPick} />
        </div>
        <div className="absolute inset-x-5 top-3 overflow-hidden rounded-2xl border border-border bg-card">
          <button
            type="button"
            data-testid="settings.home.field"
            onClick={() => setSearching(true)}
            className="flex h-12 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-muted/60"
          >
            <Home className="size-[18px] shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-base">{home?.text || t("Add home")}</span>
          </button>
          {home && (
            <>
              <div className="h-px bg-border" />
              <button
                type="button"
                data-testid="settings.home.remove"
                onClick={() => setHome(null)}
                className="flex h-11 w-full items-center px-3 text-left text-[15px] font-medium text-destructive transition-colors hover:bg-muted/60"
              >
                {t("Remove home")}
              </button>
            </>
          )}
        </div>
      </div>

      <PlacePalette
        open={searching}
        onOpenChange={(open) => {
          if (!open) closePalette();
        }}
        title={t("Home")}
        placeholder={t("Search places")}
        onChoose={(stop) => {
          setHome(stop);
          closePalette();
        }}
        onPickOnMap={closePalette}
        onMyLocation={() => void takeMyLocation()}
        locating={locating}
        locationNote={note}
      />
    </div>
  );
}

/** Where trips start and how the student gets to campus. Fills the location of every session with a place. */
export function TravelSection() {
  useLanguage();
  const isMobile = useIsMobile();
  const user = useUserStore((s) => s.user);
  const [homeOpen, setHomeOpen] = useState(false);

  if (!user) return null;
  const home = homeStop(user);
  const vehicle = vehicleFor(user.defaultTransport);

  const save = (patch: Parameters<typeof updateTravelSettings>[0]) =>
    updateTravelSettings(patch)
      .then((updated) => useUserStore.getState().setUser(updated))
      .catch(() => errorToast(t("Could not save. Try again.")));

  const pickVehicle = (id: CommuteTransport) => {
    if (id !== vehicle.id) void save({ defaultTransport: id });
  };

  const saveHome = (next: Stop | null) => {
    setHomeOpen(false);
    const same =
      next?.text === home?.text && next?.point?.lat === home?.point?.lat && next?.point?.lng === home?.point?.lng;
    if (same) return;
    void save(
      next?.point
        ? { homeLocation: next.text, homeLat: next.point.lat, homeLng: next.point.lng }
        : { homeLocation: null, homeLat: null, homeLng: null },
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("Travel")}</h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button
          type="button"
          data-testid="settings.home"
          onClick={() => setHomeOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/60"
        >
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <Home className="size-[18px]" />
          </span>
          <span className="text-base font-semibold">{t("Home")}</span>
          <span className="min-w-0 flex-1 truncate text-right text-[15px] font-medium text-muted-foreground">
            {home?.text ?? t("Add home")}
          </span>
          <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
        </button>
        <div className="h-px bg-border" />
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <span className="text-base font-semibold">{t("Vehicle")}</span>
          <div role="radiogroup" aria-label={t("Vehicle")} className={cn("flex gap-2")}>
            {VEHICLES.map((item) => (
              <VehicleChip
                key={item.id}
                id={item.id}
                label={t(item.labelKey)}
                selected={item.id === vehicle.id}
                onPress={() => pickVehicle(item.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <Sheet open={homeOpen} onOpenChange={setHomeOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn("gap-0 p-0", isMobile ? "h-[90dvh]" : "w-full sm:max-w-2xl")}
        >
          <HomePicker initial={home} onDone={saveHome} />
        </SheetContent>
      </Sheet>
    </section>
  );
}
