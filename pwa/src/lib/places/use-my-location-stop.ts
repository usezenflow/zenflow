import { useCallback, useState } from "react";
import type { MapPoint } from "@/lib/places/campus-map";
import { getMyLocation } from "@/lib/places/my-location";
import { t } from "@/lib/i18n";

/** Reads the device position for a picker and keeps the note to show when it fails. */
export function useMyLocationStop() {
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const clear = useCallback(() => setNote(null), []);

  /** The position, or `null` after setting the note. */
  const locate = useCallback(async (): Promise<MapPoint | null> => {
    setLocating(true);
    setNote(null);
    const result = await getMyLocation();
    setLocating(false);
    if (result.ok) return result.point;
    setNote(
      result.reason === "denied" ? t("Location is off. Enable it in settings.") : t("Couldn't get your location."),
    );
    return null;
  }, []);

  return { locating, note, locate, clear };
}
