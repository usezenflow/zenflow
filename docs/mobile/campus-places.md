# Campus places, map and commute

Dev-facing. The session sheet's **From** and **Location** fields suggest campus places, show the place on a map, and give the walk and car time between the two.

## Data

- Gazetteer: [`packages/core/src/campus.ts`](../../packages/core/src/campus.ts), normalised from `coords.json`.
- `A8` leads search results and the empty query.
- Timetable `SAN01` / `SAN 1` resolves to the sports ground and is stored as typed.
- Tower rooms (`A8-101`, `Tòa A8`) resolve to their tower.
- Free text that is not a campus place has no coordinates unless it was picked from search or the map. Those store `Session.locationLat` and `locationLng`.

## Map edge

The app loads the map from `<API origin>/maps`, so it follows `EXPO_PUBLIC_API_URL` with no extra setting. Staging and prod nginx serve it from [`backend/nginx/maps.conf`](../../backend/nginx/maps.conf) with `backend/tiles` mounted at `/srv/maps`. For local work the `edge` service in [`backend/compose.dev.yml`](../../backend/compose.dev.yml) listens on `8090`, config in [`backend/nginx/edge.dev.conf`](../../backend/nginx/edge.dev.conf).

| Path | Serves |
| --- | --- |
| `/maps/` | `style.json`, `style-dark.json`, `lamdong.pmtiles`, `lib/` (MapLibre GL JS, PMTiles, CSS) |
| `/osrm/foot/` | OSRM walking routes (`osrm-foot`) |
| `/osrm/car/` | OSRM driving routes (`osrm-car`) |

To use the local edge, set `EXPO_PUBLIC_MAPS_URL=http://<dev-machine-lan-ip>:8090/maps`. A phone cannot reach `localhost`.

### Setup

```bash
cd backend
./scripts/fetch-map-assets.sh      # tiles/: PMTiles extract, map libraries, style.json
# osrm/data/vietnam-latest.osm.pbf must exist (Geofabrik, 330 MB)
./scripts/osrm-prepare.sh          # osrm/data/{foot,car}: about 6 GB RAM, several minutes each
docker compose -f compose.dev.yml up -d edge osrm-foot osrm-car
```

- The PMTiles extract covers the Đà Lạt area, bbox `108.25,11.75,108.75,12.15`, zoom 0–15.
- Versions are pinned in `fetch-map-assets.sh` and in `mobile/lib/campus-map.ts`.
- Basemap labels need glyphs, which are not served yet. The map draws without text.

## Location screen

The Location row opens a full-screen route planner (`components/calendar/location-screen.tsx`).

- **To** is the session location. Search lists campus places first, then OpenStreetMap results from `GET /places/search`. Results stay inside Lam Dong and sort by distance to DLU.
- **From** is the start, saved as `Session.originLocation`. It begins as the home saved in Settings, Travel; otherwise the locate button asks for permission and uses the current position, or search a place.
- Pins, route and basemap use the brand palette (`backend/scripts/build-map-style.cjs`, light and dark). Re-run it after changing colours.
- Done saves the start and the travel time (`Session.commuteMinutes`). The session sheet shows `start to place` with the minutes, and the scheduler keeps that time clear on both sides ([ADR-0029](../adr/0029-commute-buffer.md)). Synced sessions keep their place and take only the start.
- **Vehicle** is Motorcycle (default), Car, Bike or Walk, saved as `User.defaultTransport`. Settings, Travel sets it too.

## Home and default commute

Settings, Travel saves a home (`User.homeLocation`, `homeLat`, `homeLng`) and a vehicle once. The server then gives every session that has a campus place and no commute of its own that home as the start and the travel time for the vehicle ([ADR-0031](../adr/0031-default-commute-from-home.md)). It runs after a sync and when the home or vehicle changes. Editing a session's start or minutes keeps them; removing the home takes back what was filled.
- With both points set, `GET /places/route` returns the line, distance and time, drawn on the map. Tapping the map drops a pin in the active field.

| Vehicle | Route profile | Time |
| --- | --- | --- |
| Motorcycle | car | distance at 30 km/h |
| Car | car | router time |
| Bike | bike | distance at 15 km/h |
| Walk | foot | distance at 5 km/h |

Search and routes use `NOMINATIM_URL` and `ROUTING_URL` (defaults: the public OpenStreetMap services, which throttle servers). Both are cached and spaced to one request per second. Every stack runs its own Nominatim (`nominatim` in `backend/compose.*.yml`). Dev uses `NOMINATIM_URL=http://localhost:8088`; staging and prod set it for the API. Run `backend/scripts/nominatim-extract.sh` once per host first: it clips Vietnam to Lam Dong (13 MB). The first start then imports it in a few minutes, capped at 2 GB and 2 CPUs; search is empty until `/status` returns OK. To skip the import on a server, run `backend/scripts/nominatim-preload.sh export` on a dev machine, copy the tarball over and run `restore <tgz> compose.<env>.yml` before the first `up` (ready in seconds).

## Not built yet

- Prod and staging `/osrm/` routes. Only `/maps/` is served there.
- Glyphs and sprites for labels.
- Walk minutes and leave-by.
