import { CampusMapUnavailable } from "@/components/calendar/campus-map-unavailable";
import { buildCampusMapHtml, campusMapsUrl, mapViewMessage, type MapPoint, type MapView } from "@/lib/campus-map";
import { t } from "@/lib/i18n";
import { useColorScheme } from "@/lib/useColorScheme";
import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

export interface CampusMapProps {
  /** The destination. */
  point: MapPoint;
  /** Where the route starts. */
  start?: MapPoint | null;
  /** `[lng, lat]` pairs of the route line. */
  route?: [number, number][] | null;
  /** Label for screen readers. */
  name?: string;
  /** Tapping the map picks that point. */
  onPick?: (point: MapPoint) => void;
  /** Fills its parent instead of a fixed 200 px. */
  fill?: boolean;
}

/** A map centred on one point. The marker follows `point` without reloading. */
export function CampusMap({ point, start = null, route = null, name, onPick, fill }: CampusMapProps) {
  const mapsUrl = campusMapsUrl();
  const first = useRef(point);
  const web = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const pickable = !!onPick;
  const { isDarkColorScheme: dark } = useColorScheme();
  const html = useMemo(
    () => (mapsUrl ? buildCampusMapHtml(first.current, mapsUrl, { pickable, dark }) : null),
    [mapsUrl, pickable, dark],
  );

  // The page applies views once it has loaded, and says "ready" when it has.
  const view = useRef<MapView>({ end: point, start, route });
  view.current = { end: point, start, route };
  const send = useRef(() => {});
  send.current = () => {
    const message = mapViewMessage(view.current);
    web.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent("message",{data:${JSON.stringify(message)}}));true;`,
    );
  };
  useEffect(() => send.current(), [point, start, route]);

  if (!html) return <CampusMapUnavailable />;

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; lat?: number; lng?: number };
      if (data.type === "ready") send.current();
      if (data.type === "pick" && typeof data.lat === "number" && typeof data.lng === "number") {
        onPick?.({ lat: data.lat, lng: data.lng });
      }
    } catch {}
  };

  return (
    <View testID="campus-map" className={fill ? "flex-1 overflow-hidden" : "h-[200px] overflow-hidden rounded-xl"}>
      <WebView
        ref={(node) => {
          web.current = node;
        }}
        source={{ html }}
        originWhitelist={["*"]}
        accessibilityLabel={t("Map of {place}", { place: name ?? "" })}
        onMessage={onMessage}
        nestedScrollEnabled
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
