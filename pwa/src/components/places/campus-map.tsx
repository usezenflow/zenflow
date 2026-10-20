import { useEffect, useMemo, useRef, useState } from "react";
import { Glass } from "@/components/ui/glass";
import { useLanguage, t } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { buildCampusMapHtml, campusMapsUrl, mapViewMessage, type MapPoint, type MapView } from "@/lib/places/campus-map";
import { cn } from "@/lib/utils";

export interface CampusMapProps {
  /** The destination. */
  point: MapPoint;
  /** Where the route starts. */
  start?: MapPoint | null;
  /** `[lng, lat]` pairs of the route line. */
  route?: [number, number][] | null;
  /** `[lng, lat]` pairs of the walk, drawn as footsteps. */
  walk?: [number, number][] | null;
  /** Label for screen readers. */
  name?: string;
  /** Clicking the map picks that point. */
  onPick?: (point: MapPoint) => void;
  /** Fills its parent instead of a fixed 200 px. */
  fill?: boolean;
}

/** A map centred on one point. The marker follows `point` without reloading the page. */
export function CampusMap({ point, start = null, route = null, walk = null, name, onPick, fill }: CampusMapProps) {
  useLanguage();
  // Subscribing re-renders on a theme change; the page is rebuilt for the new basemap.
  useTheme();
  const dark = document.documentElement.classList.contains("dark");
  const mapsUrl = campusMapsUrl();
  const [failed, setFailed] = useState(false);
  const first = useRef(point);
  const frame = useRef<HTMLIFrameElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const pickable = !!onPick;
  const html = useMemo(
    () => (mapsUrl ? buildCampusMapHtml(first.current, mapsUrl, { pickable, dark }) : null),
    [mapsUrl, pickable, dark],
  );

  // The page applies views once it has loaded, and says "ready" when it has.
  const view = useRef<MapView>({ end: point, start, route, walk });
  view.current = { end: point, start, route, walk };

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(mapViewMessage({ end: point, start, route, walk }), "*");
  }, [point, start, route, walk]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "ready") frame.current?.contentWindow?.postMessage(mapViewMessage(view.current), "*");
        if (data?.type === "error") setFailed(true);
        if (data?.type === "pick" && typeof data.lat === "number" && typeof data.lng === "number") {
          pick.current?.({ lat: data.lat, lng: data.lng });
        }
      } catch {
        // Messages from other frames are not ours to read.
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  if (!html || failed) {
    return (
      <Glass data-testid="campus-map-unavailable" className="flex h-[80px] items-center justify-center">
        <p className="text-[13px] text-muted-foreground">{t("Map unavailable")}</p>
      </Glass>
    );
  }

  return (
    <div
      data-testid="campus-map"
      className={cn("overflow-hidden", fill ? "h-full w-full" : "h-[200px] rounded-xl")}
    >
      <iframe
        ref={frame}
        title={t("Map of {place}", { place: name ?? "" })}
        srcDoc={html}
        className="h-full w-full border-0"
      />
    </div>
  );
}
