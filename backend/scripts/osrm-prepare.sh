#!/bin/sh
# Builds the OSRM graphs served by the dev edge (foot and car) from the Vietnam
# OSM extract in osrm/data. Needs about 6 GB RAM and a few minutes per profile.
# Run scripts/fetch-map-assets.sh first to download the extract.
set -eu
cd "$(dirname "$0")/../osrm/data"
[ -f vietnam-latest.osm.pbf ] || { echo "Missing osrm/data/vietnam-latest.osm.pbf" >&2; exit 1; }
for profile in foot car; do
  mkdir -p "$profile"
  cp -f vietnam-latest.osm.pbf "$profile/map.osm.pbf"
  docker run --rm -v "$PWD/$profile:/data" osrm/osrm-backend osrm-extract -p "/opt/$profile.lua" /data/map.osm.pbf
  docker run --rm -v "$PWD/$profile:/data" osrm/osrm-backend osrm-partition /data/map.osrm
  docker run --rm -v "$PWD/$profile:/data" osrm/osrm-backend osrm-customize /data/map.osrm
  rm -f "$profile/map.osm.pbf"
done
