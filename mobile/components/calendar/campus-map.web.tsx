import { CampusMapUnavailable } from "@/components/calendar/campus-map-unavailable";
import { buildCampusMapHtml, campusMapsUrl, mapViewMessage, type MapView } from "@/lib/campus-map";
import { t } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { CampusMapProps } from "./campus-map";

/** Web has no WebView: the same page runs in an iframe. */
export function CampusMap({ point, start = null, route = null, walk = null, name, onPick, fill }: CampusMapProps) {
  const mapsUrl = campusMapsUrl();
  const first = useRef(point);
  const frame = useRef<HTMLIFrameElement>(null);
  const pickable = !!onPick;
  const [failed, setFailed] = useState(false);
  const html = useMemo(
    () => (mapsUrl ? buildCampusMapHtml(first.current, mapsUrl, { pickable }) : null),
    [mapsUrl, pickable],
  );

  const view = useRef<MapView>({ end: point, start, route, walk });
  view.current = { end: point, start, route, walk };
  const pick = useRef(onPick);
  pick.current = onPick;
  const send = () => frame.current?.contentWindow?.postMessage(mapViewMessage(view.current), "*");
  useEffect(send, [point, start, route, walk]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "ready") send();
        if (data?.type === "pick") pick.current?.({ lat: data.lat, lng: data.lng });
        if (data?.type === "error") setFailed(true);
      } catch {}
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  if (!html || failed) return <CampusMapUnavailable />;
  return (
    <View testID="campus-map" className={fill ? "flex-1 overflow-hidden" : "h-[200px] overflow-hidden rounded-xl"}>
      <iframe
        ref={frame}
        title={t("Map of {place}", { place: name ?? "" })}
        srcDoc={html}
        style={{ border: 0, width: "100%", height: "100%" }}
      />
    </View>
  );
}
