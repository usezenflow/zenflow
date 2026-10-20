import { CAMPUS_PLACES, type CampusPlace } from "@zenflow/core";

const BACKGROUND = "#fbf3e8";
/** The dark basemap's land colour, shown before tiles arrive. */
const DARK_BACKGROUND = "#161210";
/** The app's primary orange (`--primary` in app/global.css) for pins and the route. */
const PRIMARY = "#ff8e3e";
const PRIMARY_DARK = "#ff7a24";
/** The path (ride line and footsteps) on the dark basemap: light enough to read over the brown roads. */
const DARK_PATH = "#ffc27a";

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

/** What the page shows: the destination pin, an optional start dot, the ride line and the walk's footsteps. */
export interface MapView {
  end: MapPoint | null;
  start: MapPoint | null;
  /** `[lng, lat]` pairs of the ride. */
  route: [number, number][] | null;
  /** `[lng, lat]` pairs of the walk from the gate; drawn as footsteps, not a line. */
  walk?: [number, number][] | null;
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
    routeCasing: dark ? "#0b0907" : "#ffffff",
    pathColor: dark ? DARK_PATH : PRIMARY,
    markerColor: dark ? PRIMARY_DARK : PRIMARY,
    labels: CAMPUS_PLACES.map((place) => ({ name: place.name, lng: place.lng, lat: place.lat })),
  };
  const labelCss = `.campus-label{font:600 11px/1.2 system-ui,sans-serif;color:${dark ? "#f3e6d8" : "#3a2a1a"};background:${dark ? "rgba(22,18,16,.72)" : "rgba(255,255,255,.78)"};padding:1px 6px;border-radius:999px;white-space:nowrap;pointer-events:none;box-shadow:0 1px 2px rgba(0,0,0,.2)}.hide-labels .campus-label{display:none}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<link rel="stylesheet" href="${mapsUrl}/lib/maplibre-gl.css" />
<style>html,body,#map{margin:0;height:100%;width:100%;background:${background};}${labelCss}</style>
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

/** Building names show from this zoom; below it the campus is too dense to read. */
var LABEL_MIN_ZOOM = 16;
var FOOTSTEP_GAP_M = 20;
var FOOTSTEP_OFFSET_M = 3;
var METRES_PER_DEG_LAT = 110540;
var METRES_PER_DEG_LNG = 111320;

/** A footprint pictogram; its toes point up, so a bearing of 0 walks north. */
function footstepImage() {
  var canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = config.pathColor;
  ctx.setTransform(0.65, 0, 0, 0.65, 5.6, 6);
  ctx.fill(new Path2D("M16,2 C21.5,2 22.5,8 22,12 C21.5,15.5 19.8,17.5 20,22 C20.2,26.5 22.5,28.5 22,33 C21.5,37 18.5,38 16,38 C12.5,38 10.2,36.5 10.2,32 C10.2,27.5 11.8,25.5 11.5,21 C11.2,17 10,15 10,11.5 C10,6.5 12.5,2 16,2 Z"));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  [[11.5, 4.5], [14.8, 3], [18.2, 3], [21.5, 4.5]].forEach(function (toe) {
    ctx.moveTo(toe[0] + 1.6, toe[1]);
    ctx.arc(toe[0], toe[1], 1.6, 0, Math.PI * 2);
  });
  ctx.fill();
  return ctx.getImageData(0, 0, 32, 32);
}

/** A footstep every FOOTSTEP_GAP_M metres, alternating sides, each turned to its heading. */
function footstepFeatures(coordinates) {
  var features = [];
  if (!coordinates || coordinates.length < 2) return features;
  var next = FOOTSTEP_GAP_M;
  var travelled = 0;
  var side = 1;
  for (var i = 1; i < coordinates.length; i++) {
    var a = coordinates[i - 1];
    var b = coordinates[i];
    var dx = (b[0] - a[0]) * METRES_PER_DEG_LNG * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    var dy = (b[1] - a[1]) * METRES_PER_DEG_LAT;
    var length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    var heading = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    var rad = heading * Math.PI / 180;
    while (travelled + length >= next) {
      var f = (next - travelled) / length;
      var lng = a[0] + (b[0] - a[0]) * f;
      var lat = a[1] + (b[1] - a[1]) * f;
      // Right of the heading: east is cos(heading), north is -sin(heading).
      var offset = FOOTSTEP_OFFSET_M * side;
      lng += (Math.cos(rad) * offset) / (METRES_PER_DEG_LNG * Math.cos(lat * Math.PI / 180));
      lat += (-Math.sin(rad) * offset) / METRES_PER_DEG_LAT;
      features.push({ type: "Feature", properties: { bearing: heading }, geometry: { type: "Point", coordinates: [lng, lat] } });
      next += FOOTSTEP_GAP_M;
      side = -side;
    }
    travelled += length;
  }
  return features;
}

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
  config.labels.forEach(function (place) {
    var label = document.createElement("div");
    label.className = "campus-label";
    label.textContent = place.name;
    new maplibregl.Marker({ element: label }).setLngLat([place.lng, place.lat]).addTo(map);
  });
  function syncLabels() {
    document.getElementById("map").classList.toggle("hide-labels", map.getZoom() < LABEL_MIN_ZOOM);
  }
  map.on("zoom", syncLabels);
  syncLabels();
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
        paint: { "line-color": config.pathColor, "line-width": 16, "line-opacity": 0.22, "line-blur": 3 }
      });
      map.addLayer({
        id: "route-casing", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": config.routeCasing, "line-width": 9 }
      });
      map.addLayer({
        id: "route", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": config.pathColor, "line-width": 5 }
      });
    }
  }
  function drawWalk(coordinates) {
    if (!map.hasImage("footstep")) map.addImage("footstep", footstepImage());
    var data = { type: "FeatureCollection", features: footstepFeatures(coordinates) };
    var source = map.getSource("walk-steps");
    if (source) source.setData(data);
    else {
      map.addSource("walk-steps", { type: "geojson", data: data });
      map.addLayer({
        id: "walk-steps", type: "symbol", source: "walk-steps",
        layout: {
          "icon-image": "footstep",
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 0.75
        }
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
    drawWalk(view.walk);
    var points = [];
    if (view.start) points.push([view.start.lng, view.start.lat]);
    if (view.end) points.push([view.end.lng, view.end.lat]);
    if (view.route && view.route.length) points = view.route.concat(view.walk || []);
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
if (!window.maplibregl || !window.pmtiles) {
  var failure = JSON.stringify({ type: "error" });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(failure);
  else window.parent.postMessage(failure, "*");
} else {
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
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
}
</script>
</body>
</html>`;
}
