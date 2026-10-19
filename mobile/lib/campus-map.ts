import type { CampusPlace } from "@zenflow/core";

const BACKGROUND = "#fbf3e8";
/** The dark basemap's land colour, shown before tiles arrive. */
const DARK_BACKGROUND = "#161210";
/** The app's primary orange (`--primary` in app/global.css) for pins and the route. */
const PRIMARY = "#ff8e3e";
const PRIMARY_DARK = "#ff7a24";

/**
 * Base URL of the map edge: style, PMTiles and map libraries. It lives on the
 * API origin (`<origin>/maps`); `EXPO_PUBLIC_MAPS_URL` overrides it.
 */
export function campusMapsUrl(): string | null {
  const override = process.env.EXPO_PUBLIC_MAPS_URL?.trim().replace(/\/+$/, "");
  if (override) return override;
  const api = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!api) return null;
  try {
    return `${new URL(api).origin}/maps`;
  } catch {
    return null;
  }
}

/** A point on the map, `lat`/`lng` in degrees. */
export interface MapPoint {
  lat: number;
  lng: number;
}

/** What the page shows: the destination pin, an optional start dot and the route line. */
export interface MapView {
  end: MapPoint | null;
  start: MapPoint | null;
  /** `[lng, lat]` pairs. */
  route: [number, number][] | null;
}

/** The message that updates a running page. */
export function mapViewMessage(view: MapView): string {
  return JSON.stringify({ type: "view", ...view });
}

/** Serialises for an inline script. `<` is escaped so a value cannot close the tag. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * A self-contained page. MapLibre GL JS and the PMTiles protocol load from the
 * map edge; the style is fetched and its `pmtiles://` sources are resolved
 * against the style URL. A failed style falls back to a blank background.
 * `dark` picks the dark basemap (`style-dark.json`).
 */
export function buildCampusMapHtml(
  place: MapPoint | CampusPlace,
  mapsUrl: string,
  options: { pickable?: boolean; zoom?: number; dark?: boolean } = {},
): string {
  const dark = options.dark ?? false;
  const background = dark ? DARK_BACKGROUND : BACKGROUND;
  const config = {
    center: [place.lng, place.lat],
    pickable: options.pickable ?? false,
    zoom: options.zoom ?? 16,
    mapsUrl,
    background,
    style: dark ? "style-dark.json" : "style.json",
    routeCasing: dark ? "#111418" : "#ffffff",
    markerColor: dark ? PRIMARY_DARK : PRIMARY,
  };
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<link rel="stylesheet" href="${mapsUrl}/lib/maplibre-gl.css" />
<style>html,body,#map{margin:0;height:100%;width:100%;background:${background};}</style>
</head>
<body>
<div id="map"></div>
<script src="${mapsUrl}/lib/maplibre-gl.js"></script>
<script src="${mapsUrl}/lib/pmtiles.js"></script>
<script>
var config = ${jsonForScript(config)};
var blank = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": config.background } }]
};
maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);

function show(style) {
  var map = new maplibregl.Map({
    container: "map",
    style: style,
    center: config.center,
    zoom: config.zoom,
    attributionControl: false
  });
  var pin = document.createElement("div");
  pin.style.cssText = "width:34px;height:44px;filter:drop-shadow(0 3px 3px rgba(40,20,0,.35));";
  pin.innerHTML = '<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 42C17 42 3 27 3 17C3 8.7 9.3 2 17 2s14 6.7 14 15C31 27 17 42 17 42z" fill="' + config.markerColor + '" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><circle cx="17" cy="17" r="5.5" fill="#fff"/></svg>';
  var endMarker = new maplibregl.Marker({ element: pin, anchor: "bottom" }).setLngLat(config.center).addTo(map);
  var startMarker = null;
  var loaded = false;
  var pending = null;
  function post(message) {
    var text = JSON.stringify(message);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
    else window.parent.postMessage(text, "*");
  }
  function drawRoute(coordinates) {
    var data = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coordinates || [] }
    };
    var source = map.getSource("route");
    if (source) source.setData(data);
    else if (coordinates && coordinates.length) {
      map.addSource("route", { type: "geojson", data: data });
      map.addLayer({
        id: "route-glow", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": config.markerColor, "line-width": 16, "line-opacity": 0.22, "line-blur": 3 }
      });
      map.addLayer({
        id: "route-casing", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": config.routeCasing, "line-width": 9 }
      });
      map.addLayer({
        id: "route", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": config.markerColor, "line-width": 5 }
      });
    }
  }
  function apply(view) {
    if (!loaded) { pending = view; return; }
    if (view.end) endMarker.setLngLat([view.end.lng, view.end.lat]);
    if (view.start) {
      if (!startMarker) {
        var dot = document.createElement("div");
        dot.style.cssText = "width:16px;height:16px;border-radius:50%;background:#fff;border:4px solid " + config.markerColor + ";box-shadow:0 0 0 6px " + config.markerColor + "33, 0 1px 3px rgba(0,0,0,.35)";
        startMarker = new maplibregl.Marker({ element: dot });
      }
      startMarker.setLngLat([view.start.lng, view.start.lat]).addTo(map);
    } else if (startMarker) { startMarker.remove(); }
    drawRoute(view.route);
    var points = [];
    if (view.start) points.push([view.start.lng, view.start.lat]);
    if (view.end) points.push([view.end.lng, view.end.lat]);
    if (view.route && view.route.length) points = view.route;
    if (points.length > 1) {
      var bounds = points.reduce(function (b, c) { return b.extend(c); }, new maplibregl.LngLatBounds(points[0], points[0]));
      map.fitBounds(bounds, { padding: 48, duration: 400, maxZoom: 17 });
    } else if (view.end) {
      map.flyTo({ center: [view.end.lng, view.end.lat], zoom: config.zoom });
    }
  }
  map.on("load", function () {
    loaded = true;
    post({ type: "ready" });
    if (pending) { var view = pending; pending = null; apply(view); }
  });
  if (config.pickable) {
    map.on("click", function (event) {
      post({ type: "pick", lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
  }
  window.addEventListener("message", function (event) {
    try {
      var data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data && data.type === "view") apply(data);
    } catch (e) {}
  });
  document.addEventListener("message", function (event) { window.dispatchEvent(new MessageEvent("message", { data: event.data })); });
}

var styleUrl = config.mapsUrl + "/" + config.style;
fetch(styleUrl)
  .then(function (response) {
    if (!response.ok) throw new Error("style " + response.status);
    return response.json();
  })
  .then(function (style) {
    Object.keys(style.sources).forEach(function (key) {
      var source = style.sources[key];
      if (source.url && source.url.indexOf("pmtiles://") === 0) {
        source.url = "pmtiles://" + new URL(source.url.slice("pmtiles://".length), styleUrl).href;
      }
    });
    show(style);
  })
  .catch(function () { show(blank); });
</script>
</body>
</html>`;
}
