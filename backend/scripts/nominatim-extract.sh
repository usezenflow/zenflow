#!/bin/sh
# Clips the Vietnam OSM extract to Lam Dong (the box PlacesService searches) so
# Nominatim imports in minutes and a few GB instead of an hour and 10 GB.
# Writes nominatim/lamdong.osm.pbf, which every compose file mounts. Run it once
# on each host before the first `up`; reuses osrm/data/vietnam-latest.osm.pbf
# when present, otherwise downloads it to a temp dir.
set -eu
cd "$(dirname "$0")/.."
BBOX=${NOMINATIM_BBOX:-107.3,11.1,108.9,12.3}
SRC=osrm/data/vietnam-latest.osm.pbf
mkdir -p nominatim
TMP=$(mktemp -d "$PWD/nominatim/.tmp.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
if [ ! -f "$SRC" ]; then
  curl -fL -o "$TMP/vietnam-latest.osm.pbf" https://download.geofabrik.de/asia/vietnam-latest.osm.pbf
  SRC=$TMP/vietnam-latest.osm.pbf
fi
cp "$SRC" "$TMP/in.osm.pbf"
docker run --rm -v "$TMP:/data" --entrypoint osmium iboates/osmium:latest \
  extract --bbox "$BBOX" --strategy complete_ways --overwrite -o /data/out.osm.pbf /data/in.osm.pbf
mv "$TMP/out.osm.pbf" nominatim/lamdong.osm.pbf
ls -lh nominatim/lamdong.osm.pbf
