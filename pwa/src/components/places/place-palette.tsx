import { useEffect, useMemo, useState } from "react";
import { Home, LocateFixed, MapPin, type LucideIcon } from "lucide-react";
import { searchCampusPlaces } from "@zenflow/core";
import { searchPlaces, type PlaceResult } from "@/api/places";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { t, useLanguage } from "@/lib/i18n";
import type { Stop } from "@/lib/places/location";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 300;
const MIN_REMOTE_QUERY = 3;
const CAMPUS_LIMIT = 4;

export interface PlacePaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder: string;
  onChoose: (stop: Stop) => void;
  /** Closes the palette so the next map click pins the stop. */
  onPickOnMap: () => void;
  /** Present only for the start, which can be the user's position. */
  onMyLocation?: () => void;
  /** The start offered first, when the student saved one in settings. */
  home?: Stop | null;
  locating: boolean;
  locationNote: string | null;
}

const TONE = {
  orange: "bg-brand-orange/15 text-brand-orange",
  lime: "bg-brand-lime/15 text-brand-lime",
  yellow: "bg-brand-yellow/20 text-brand-yellow",
} as const;

function Option({
  testId,
  value,
  icon: Icon = MapPin,
  tone = "orange",
  label,
  detail,
  onSelect,
}: {
  testId: string;
  value: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONE;
  label: string;
  detail?: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      data-testid={testId}
      value={value}
      onSelect={onSelect}
      className="gap-3"
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl",
          TONE[tone],
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">
          {label}
        </span>
        {detail ? (
          <span className="block truncate text-[13px] text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </CommandItem>
  );
}

/** The search for one stop, shown as a command palette over the planner. Its query resets each time it opens. */
export function PlacePalette({
  open,
  onOpenChange,
  title,
  placeholder,
  onChoose,
  onPickOnMap,
  onMyLocation,
  home,
  locating,
  locationNote,
}: PlacePaletteProps) {
  useLanguage();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const q = query.trim();
  const campus = useMemo(() => searchCampusPlaces(q, CAMPUS_LIMIT), [q]);

  useEffect(() => {
    setFailed(false);
    if (q.length < MIN_REMOTE_QUERY) {
      setRemote([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchPlaces(q, controller.signal)
        .then((places) => setRemote(places))
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, attempt]);

  const typed = q !== "";
  const nothing =
    typed &&
    !searching &&
    !failed &&
    campus.length === 0 &&
    remote.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="session.location.palette"
        showCloseButton={false}
        className="top-[15%] translate-y-0 gap-0 overflow-hidden rounded-3xl border-brand-orange/20 p-0 shadow-xl sm:max-w-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{placeholder}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-brand-orange [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-input]]:text-base [&_[cmdk-item]]:rounded-2xl [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-3 [&_[cmdk-item][data-selected=true]]:bg-brand-orange/10 [&_[cmdk-item][data-selected=true]]:text-foreground **:data-[slot=command-input-wrapper]:h-16 **:data-[slot=command-input-wrapper]:bg-brand-orange/10 **:data-[slot=command-input-wrapper]:px-5 **:data-[slot=command-input-wrapper]:text-brand-orange"
        >
          <CommandInput
            data-testid="session.location.palette.input"
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
          />
          <CommandList className="max-h-[min(60dvh,420px)] p-2">
            {!typed && (
              <CommandGroup>
                {home && (
                  <Option
                    testId="session.location.home"
                    value="home"
                    icon={Home}
                    tone="orange"
                    label={t("Home")}
                    detail={home.text}
                    onSelect={() => onChoose(home)}
                  />
                )}
                {onMyLocation && (
                  <Option
                    testId="session.location.mine"
                    value="my location"
                    icon={LocateFixed}
                    tone="lime"
                    label={
                      locating
                        ? t("Finding your location…")
                        : t("Use my location")
                    }
                    onSelect={onMyLocation}
                  />
                )}
                <Option
                  testId="session.location.pick"
                  value="pick on map"
                  tone="yellow"
                  label={t("Pick on map")}
                  onSelect={onPickOnMap}
                />
                {locationNote && (
                  <p
                    data-testid="session.location.note"
                    className="mx-2 mt-2 rounded-2xl bg-brand-lime/15 px-4 py-3 text-sm text-foreground"
                  >
                    {locationNote}
                  </p>
                )}
              </CommandGroup>
            )}

            {campus.length > 0 && (
              <CommandGroup heading={t("Campus")}>
                {campus.map((suggestion, index) => (
                  <Option
                    key={`${suggestion.value}-${suggestion.place.name}`}
                    testId="session.location.suggestion"
                    value={`campus ${index} ${suggestion.value}`}
                    tone="orange"
                    label={suggestion.value}
                    detail={
                      suggestion.value === suggestion.place.name
                        ? undefined
                        : suggestion.place.name
                    }
                    onSelect={() =>
                      onChoose({
                        text: suggestion.value,
                        point: {
                          lat: suggestion.place.lat,
                          lng: suggestion.place.lng,
                        },
                      })
                    }
                  />
                ))}
              </CommandGroup>
            )}

            {remote.length > 0 && (
              <CommandGroup heading={t("Places")}>
                {remote.map((place, index) => (
                  <Option
                    key={`${place.lat},${place.lng},${place.name}`}
                    testId="session.location.place"
                    value={`place ${index} ${place.name}`}
                    tone="lime"
                    label={place.name}
                    detail={place.address}
                    onSelect={() =>
                      onChoose({
                        text: place.name,
                        point: { lat: place.lat, lng: place.lng },
                      })
                    }
                  />
                ))}
              </CommandGroup>
            )}

            {typed && searching && remote.length === 0 && (
              <div className="flex flex-col gap-3 px-3 py-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-10 shrink-0 rounded-2xl" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-3.5 w-2/3 rounded-full" />
                      <Skeleton className="h-3 w-full rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {failed && (
              <div className="flex flex-col items-center gap-3 px-8 py-10">
                <p className="text-center text-[15px] text-muted-foreground">
                  {t("Couldn't search. Try again.")}
                </p>
                <button
                  type="button"
                  data-testid="session.location.retry"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                >
                  {t("Try again")}
                </button>
              </div>
            )}

            {nothing && (
              <p className="py-10 text-center text-[15px] text-muted-foreground">
                {t("No places found")}
              </p>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
