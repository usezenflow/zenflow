import type { MapPoint } from "@/lib/campus-map";
import { t } from "@/lib/i18n";
import { getMyLocation } from "@/lib/my-location";
import { useState } from "react";

/** Reads the device position for a picker and keeps the note to show when it fails. */
export function useMyLocationStop() {
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [settingsNeeded, setSettingsNeeded] = useState(false);

  const clear = () => {
    setNote(null);
    setSettingsNeeded(false);
  };

  /** The position, or `null` after setting the note. */
  const locate = async (): Promise<MapPoint | null> => {
    setLocating(true);
    clear();
    const result = await getMyLocation();
    setLocating(false);
    if (result.ok) return result.point;
    setSettingsNeeded(result.reason === "blocked" || result.reason === "services-off");
    setNote(
      result.reason === "denied" || result.reason === "blocked"
        ? t("Location is off. Enable it in settings.")
        : result.reason === "services-off"
          ? t("Turn on location services.")
          : t("Couldn't get your location."),
    );
    return null;
  };

  return { locating, note, settingsNeeded, locate, clear };
}
