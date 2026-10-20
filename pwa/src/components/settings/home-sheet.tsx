import { Fragment, useEffect, useState } from "react";
import { MapPin, Search, Trash2 } from "lucide-react";
import { type PlaceResult, searchPlaces, type TravelSettingsInput, updateTravelSettings } from "@/api/places";
import {
  Divider,
  IconTile,
  SettingsCard,
  SettingsSheet,
} from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserStore } from "@/hooks/use-user-store";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

/** Search for the home address and save it with its coordinates, or remove it. */
export function HomeSheet({
  open,
  onOpenChange,
  home,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  home: string | null;
}) {
  useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchPlaces(q, controller.signal)
        .then((found) => setResults(found))
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  async function save(input: TravelSettingsInput) {
    setSaving(true);
    try {
      useUserStore.getState().setUser(await updateTravelSettings(input));
      onOpenChange(false);
    } catch {
      errorToast(t("Couldn't save preference"), {
        description: t("Try again in a moment."),
      });
    } finally {
      setSaving(false);
    }
  }

  const showEmpty = query.trim().length >= MIN_QUERY && !searching && results.length === 0;

  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={t("Home")}>
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search home address")}
            aria-label={t("Search home address")}
            className="h-11 rounded-full pl-10 text-base focus-visible:border-primary/50 focus-visible:ring-primary/15"
          />
        </div>

        {query.trim().length < MIN_QUERY ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MapPin className="size-6" />
            </span>
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              {t("Type a street, building or place.")}
            </p>
          </div>
        ) : null}

        {results.length > 0 ? (
          <SettingsCard>
            {results.map((place, i) => (
              <Fragment key={`${place.lat},${place.lng}`}>
                {i > 0 && <Divider />}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void save({ homeLocation: place.name, homeLat: place.lat, homeLng: place.lng })
                  }
                  className="flex w-full items-center gap-[13px] px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                >
                  <IconTile icon={MapPin} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold">{place.name}</span>
                    {place.address ? (
                      <span className="truncate text-[13px] text-muted-foreground">{place.address}</span>
                    ) : null}
                  </span>
                </button>
              </Fragment>
            ))}
          </SettingsCard>
        ) : null}

        {showEmpty ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("No places found")}</p>
        ) : null}

        {home ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => void save({ homeLocation: null, homeLat: null, homeLng: null })}
            className="h-11 w-full rounded-full text-[15px] font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            {t("Remove home")}
          </Button>
        ) : null}
      </div>
    </SettingsSheet>
  );
}
