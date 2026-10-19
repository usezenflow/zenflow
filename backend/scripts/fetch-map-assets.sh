#!/bin/sh
# Downloads the dev map assets into tiles/ (git-ignored):
#   lamdong.pmtiles   Protomaps extract around Đà Lạt (bbox below, z0-15)
#   lib/              maplibre-gl, pmtiles and @protomaps/basemaps browser bundles
#   style.json        basemap style over lamdong.pmtiles
# Pinned versions match mobile/lib/campus-map.ts and the page it builds.
set -eu
cd "$(dirname "$0")/.."
BUILD=${PROTOMAPS_BUILD:-20261018}
BBOX=${PMTILES_BBOX:-108.25,11.75,108.75,12.15}
mkdir -p tiles/lib
if [ ! -f tiles/lamdong.pmtiles ]; then
  docker run --rm -v "$PWD/tiles:/out" protomaps/go-pmtiles:latest \
    extract "https://build.protomaps.com/$BUILD.pmtiles" /out/lamdong.pmtiles \
    --bbox="$BBOX" --maxzoom=15
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for pkg in maplibre-gl@4.7.1 pmtiles@3.2.1 @protomaps/basemaps@5.7.2; do
  (cd "$TMP" && npm pack --silent "$pkg" >/dev/null)
done
for tgz in "$TMP"/*.tgz; do
  name=$(basename "$tgz" .tgz)
  mkdir -p "$TMP/$name" && tar -xzf "$tgz" -C "$TMP/$name"
done
cp "$TMP"/maplibre-gl-*/package/dist/maplibre-gl.js "$TMP"/maplibre-gl-*/package/dist/maplibre-gl.css tiles/lib/
cp "$TMP"/pmtiles-*/package/dist/pmtiles.js tiles/lib/
cp "$TMP"/protomaps-basemaps-*/package/dist/basemaps.js tiles/lib/
node scripts/build-map-style.cjs
