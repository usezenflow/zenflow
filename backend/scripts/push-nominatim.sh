#!/bin/sh
# Pushes the Lam Dong extract and the preloaded Nominatim database to the VPS.
# Build them first: scripts/nominatim-extract.sh and `scripts/nominatim-preload.sh export`.
# Then on the VPS: sh scripts/nominatim-preload.sh restore nominatim/nominatim-data.tgz compose.<env>.yml
#
#   scripts/push-nominatim.sh [host]    (default admin@zenflow, dir REMOTE_DIR=/opt/zenflow/backend)
set -eu
cd "$(dirname "$0")/.."
HOST=${1:-admin@zenflow}
REMOTE_DIR=${REMOTE_DIR:-/opt/zenflow/backend}
for f in nominatim/lamdong.osm.pbf nominatim/nominatim-data.tgz; do
  [ -f "$f" ] || { echo "Missing $f" >&2; exit 1; }
done
ssh "$HOST" "mkdir -p $REMOTE_DIR/nominatim $REMOTE_DIR/scripts"
scp nominatim/lamdong.osm.pbf nominatim/nominatim-data.tgz "$HOST:$REMOTE_DIR/nominatim/"
scp scripts/nominatim-preload.sh scripts/nominatim-extract.sh "$HOST:$REMOTE_DIR/scripts/"
