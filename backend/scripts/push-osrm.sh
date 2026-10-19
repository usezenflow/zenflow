#!/bin/sh
# Pushes the OSRM graphs (foot and car) to the VPS. Build them first with
# scripts/osrm-prepare.sh. The source extract is not sent.
#
#   scripts/push-osrm.sh [host]    (default admin@zenflow, dir REMOTE_DIR=/opt/zenflow/backend)
set -eu
cd "$(dirname "$0")/.."
HOST=${1:-admin@zenflow}
REMOTE_DIR=${REMOTE_DIR:-/opt/zenflow/backend}
for p in foot car; do
  [ -f "osrm/data/$p/map.osrm" ] || { echo "Missing osrm/data/$p/map.osrm; run scripts/osrm-prepare.sh" >&2; exit 1; }
done
ssh "$HOST" "mkdir -p $REMOTE_DIR/osrm/data/foot $REMOTE_DIR/osrm/data/car"
for p in foot car; do
  scp osrm/data/$p/map.osrm* "$HOST:$REMOTE_DIR/osrm/data/$p/"
done
