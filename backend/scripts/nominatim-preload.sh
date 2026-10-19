#!/bin/sh
# Imports Nominatim once on a strong machine, then ships the finished database
# so the server starts search in seconds instead of importing.
#
#   scripts/nominatim-preload.sh export [out.tgz]
#       Clips Lam Dong, imports it into a throwaway volume and writes the volume
#       to out.tgz (default nominatim/nominatim-data.tgz).
#   scripts/nominatim-preload.sh restore <in.tgz> <compose-file>
#       Fills that stack's nominatim_data volume from in.tgz. Run it before the
#       first `up`. Refuses a volume that already holds data.
#
# Postgres files are portable between arm64 and amd64 in practice but not by
# guarantee: if Nominatim fails to start after a restore, drop the volume and
# let it import itself (a couple of minutes).
set -eu
cd "$(dirname "$0")/.."
IMAGE=mediagis/nominatim:5.1
PGDIR=/var/lib/postgresql/16/main

case "${1:-}" in
export)
  OUT=${2:-nominatim/nominatim-data.tgz}
  [ -f nominatim/lamdong.osm.pbf ] || sh scripts/nominatim-extract.sh
  VOL=zenflow-nominatim-preload
  NAME=zenflow-nominatim-preload
  trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true' EXIT
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker volume create "$VOL" >/dev/null
  docker run -d --name "$NAME" --shm-size 1g \
    -e PBF_PATH=/pbf/lamdong.osm.pbf -e NOMINATIM_PASSWORD=nominatim -e IMPORT_STYLE=full -e THREADS=4 \
    -v "$PWD/nominatim/lamdong.osm.pbf:/pbf/lamdong.osm.pbf:ro" -v "$VOL:$PGDIR" "$IMAGE" >/dev/null
  echo "Importing (a few minutes)..."
  until docker exec "$NAME" curl -fs http://localhost:8080/status >/dev/null 2>&1; do
    docker ps -q -f "name=$NAME" | grep -q . || { docker logs --tail 20 "$NAME"; echo "Import failed" >&2; exit 1; }
    sleep 5
  done
  # A clean stop flushes Postgres, so the copy is consistent.
  docker stop -t 120 "$NAME" >/dev/null
  mkdir -p "$(dirname "$OUT")"
  OUT_DIR=$(cd "$(dirname "$OUT")" && pwd)
  docker run --rm -v "$VOL:/v:ro" -v "$OUT_DIR:/out" alpine tar czf "/out/$(basename "$OUT")" -C /v .
  ls -lh "$OUT"
  echo "Next: scp it to the server, then: sh scripts/nominatim-preload.sh restore $(basename "$OUT") compose.<env>.yml"
  ;;
restore)
  IN=${2:?usage: restore <in.tgz> <compose-file>}
  COMPOSE=${3:?usage: restore <in.tgz> <compose-file>}
  [ -f "$IN" ] || { echo "Missing $IN" >&2; exit 1; }
  VOL=$(docker compose -f "$COMPOSE" config | awk '/^volumes:/{v=1} v&&/^  nominatim_data:/{n=1} n&&/name:/{print $2; exit}')
  [ -n "$VOL" ] || { echo "No nominatim_data volume in $COMPOSE" >&2; exit 1; }
  docker volume create "$VOL" >/dev/null
  IN_DIR=$(cd "$(dirname "$IN")" && pwd)
  docker run --rm -v "$VOL:/v" -v "$IN_DIR:/in:ro" alpine sh -c \
    '[ -z "$(ls -A /v)" ] || { echo "Volume '"$VOL"' already has data" >&2; exit 1; }; tar xzf "/in/'"$(basename "$IN")"'" -C /v'
  echo "Restored into $VOL. Start the stack; Nominatim skips the import."
  ;;
*)
  echo "usage: $0 export [out.tgz] | restore <in.tgz> <compose-file>" >&2
  exit 2
  ;;
esac
