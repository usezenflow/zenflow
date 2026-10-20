import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SettingsSheet } from "@/components/settings/settings-ui";
import { saveUser } from "@/components/settings/save-user";
import { Input } from "@/components/ui/input";
import { locale, t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Zones listed before the user searches; a search narrows the full list. */
const RESULT_LIMIT = 50;

const labelCache = new Map<string, string>();

/** "GMT+7", "GMT+5:30" or "GMT" for `tz` now. */
function gmtLabel(tz: string): string {
  let label = labelCache.get(tz);
  if (label === undefined) {
    label =
      new Intl.DateTimeFormat(locale(), { timeZone: tz, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    labelCache.set(tz, label);
  }
  return label;
}

function offsetMinutes(tz: string): number {
  const match = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(gmtLabel(tz));
  if (!match?.[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/**
 * Case-insensitive search ("_" and " " are interchangeable), nearest UTC
 * offset to the device zone first, then the same region, then name.
 */
function searchZones(query: string, zones: string[], device: string): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  const hits = q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones;
  const ref = offsetMinutes(device);
  const region = device.split("/")[0];
  return [...hits].sort(
    (a, b) =>
      Math.abs(offsetMinutes(a) - ref) - Math.abs(offsetMinutes(b) - ref) ||
      Number(b.startsWith(`${region}/`)) - Number(a.startsWith(`${region}/`)) ||
      a.localeCompare(b),
  );
}

/** Searchable IANA timezone picker, with the device zone pinned first, like mobile. */
export function TimezoneSheet({
  open,
  onOpenChange,
  value,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
}) {
  useLanguage();
  const [query, setQuery] = useState("");
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = useMemo(() => [...new Set([...allZones(), value])], [value]);
  const hits = useMemo(
    () => searchZones(query, zones, device).filter((zone) => zone !== device || query.trim() !== ""),
    [query, zones, device],
  );
  const shown = hits.slice(0, RESULT_LIMIT);
  const showDevice = query.trim() === "";

  async function select(timezone: string) {
    onOpenChange(false);
    if (timezone === value) return;
    if (!(await saveUser({ timezone }))) {
      errorToast(t("Couldn't save preference"), {
        description: t("Try again in a moment."),
      });
    }
  }

  const rows = showDevice ? [device, ...shown] : shown;

  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={t("Timezone")}>
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("Search")}
        aria-label={t("Search")}
        className="mb-3"
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("No matches")}</p>
      ) : (
        <div role="radiogroup" className="-mx-2 flex flex-col">
          {rows.map((zone, index) => {
            const selected = zone === value;
            const label = showDevice && index === 0 ? t("Device ({zone})", { zone }) : zone;
            return (
              <button
                key={`${index}:${zone}`}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void select(zone)}
                className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "truncate text-[15px]",
                      selected ? "font-semibold text-primary" : "text-foreground",
                    )}
                  >
                    {label}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{gmtLabel(zone)}</span>
                </span>
                {selected ? <Check className="size-[18px] shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      )}
      {hits.length > RESULT_LIMIT ? (
        <p className="pt-3 text-center text-[13px] text-muted-foreground">
          {t("Search to see more zones.")}
        </p>
      ) : null}
    </SettingsSheet>
  );
}
