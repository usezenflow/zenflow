#!/bin/sh
# Pushes the basemap (PMTiles, styles, map libraries) to the VPS, where nginx
# serves it at /maps. Build it first with scripts/fetch-map-assets.sh.
#
#   scripts/push-tiles.sh [host]    (default admin@zenflow, dir REMOTE_DIR=/opt/zenflow/backend)
set -eu
cd "$(dirname "$0")/.."
HOST=${1:-admin@zenflow}
REMOTE_DIR=${REMOTE_DIR:-/opt/zenflow/backend}
for f in lamdong.pmtiles style.json style-dark.json lib; do
  [ -e "tiles/$f" ] || { echo "Missing tiles/$f; run scripts/fetch-map-assets.sh" >&2; exit 1; }
done
ssh "$HOST" "mkdir -p $REMOTE_DIR/tiles"
scp -r tiles/lamdong.pmtiles tiles/style.json tiles/style-dark.json tiles/lib "$HOST:$REMOTE_DIR/tiles/"
# nginx runs as another user; a restrictive umask on the VPS would answer 403.
ssh "$HOST" "chmod -R a+rX $REMOTE_DIR/tiles"
