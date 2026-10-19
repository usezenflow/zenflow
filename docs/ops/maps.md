# Maps: Nominatim and OSRM

For operators. Place search (Nominatim) and routing (OSRM) run in staging and prod on the `geo` network. Build the data on a strong machine, push it to the VPS, then start the stack.

| Item | Value |
| --- | --- |
| Services | `nominatim`, `osrm-foot`, `osrm-car` in `backend/compose.staging.yml` and `compose.prod.yml` |
| Routing URLs | `/osrm/foot/` and `/osrm/car/` on the API origin (`backend/nginx/maps.conf`) |
| Search | API only, `NOMINATIM_URL=http://nominatim:8080` |
| Basemap | `/maps/` on the API origin, served from `backend/tiles` |
| Push scripts | `backend/scripts/push-tiles.sh`, `push-nominatim.sh`, `push-osrm.sh` |
| Remote dir | `/opt/zenflow/backend` (override with `REMOTE_DIR`) |

## Build locally

Run from `backend/`. Needs Docker and about 6 GB RAM.

```sh
sh scripts/fetch-map-assets.sh
sh scripts/osrm-prepare.sh
sh scripts/nominatim-extract.sh
sh scripts/nominatim-preload.sh export
```

This writes `osrm/data/{foot,car}/map.osrm*` (about 7 GB), `nominatim/lamdong.osm.pbf` and `nominatim/nominatim-data.tgz`.

## Push

`admin` needs write access to the data directories, which `deploy` owns after [server-access.md](server-access.md#2-hand-deploy-files-to-deploy). One time, on the VPS:

```sh
sudo usermod -aG deploy admin
sudo install -d -o deploy -g deploy -m 2775 /opt/zenflow/backend/{tiles,nominatim,osrm,osrm/data,osrm/data/foot,osrm/data/car,scripts}
```

Log in again so the group applies. Set up the `zenflow` host alias first ([server-access.md](server-access.md#7-laptop-setup)).

```sh
sh scripts/push-tiles.sh
sh scripts/push-osrm.sh
sh scripts/push-nominatim.sh
```

All default to `admin@zenflow`; pass another host as the first argument.

## Start on the VPS

Run from `/opt/zenflow/backend`. Restore the Nominatim volume before the first `up`; it refuses a volume that already has data.

```sh
sh scripts/nominatim-preload.sh restore nominatim/nominatim-data.tgz compose.prod.yml
docker compose -f compose.prod.yml up -d nominatim osrm-foot osrm-car
docker compose -f compose.prod.yml restart nginx
```

Use `compose.staging.yml` for staging.

## Verify

```sh
docker exec zenflow-nominatim-prod curl -fs http://localhost:8080/status
curl -fs 'https://<api-host>/osrm/foot/route/v1/foot/108.44,11.94;108.45,11.95'
curl -sI https://<api-host>/maps/lib/maplibre-gl.js
```

The last call returns `200`. Cloudflare sits in front of the API, so after fixing a failed `/maps/` response, purge by prefix `api.usezenflow.com/maps` (Caching, Purge Cache, Custom Purge, Prefix). Otherwise the edge keeps serving the old error.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nominatim fails after restore | Drop the `nominatim_data` volume and let it import from the pbf (a few minutes) |
| OSRM exits at start | A `map.osrm*` file is missing; rerun `push-osrm.sh` |
| `/osrm/...` returns 502 | `osrm-*` is not running, or nginx is not on `geo`; recreate nginx |
| `/maps/` is 403 or 404 in the app but 200 on the server | Cloudflare cached the error; purge the `api.usezenflow.com/maps` prefix |
| `/maps/` returns 403 | Run `push-tiles.sh` again; it makes the files world-readable |
| `/maps/` returns 404 | `backend/tiles` was never pushed; run `push-tiles.sh` |
