#!/usr/bin/env bash
# Rotates a versioned secret `<PREFIX>_V<n>` in the api set (see
# backend/src/common/config/versioned-secret.ts).
#
#   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=... VAULT_ENV=prod \
#     ./ops/vault/rotate-versioned.sh migrate API_TOKEN_PEPPER
#   VAULT_ADDR=... VAULT_TOKEN=... VAULT_ENV=prod \
#     ./ops/vault/rotate-versioned.sh rotate API_TOKEN_PEPPER
#
# migrate: moves the unversioned <PREFIX> to <PREFIX>_V1 and removes the old key
#   in one write. Run it with the release that reads the versioned name.
# rotate: writes a new random <PREFIX>_V<n+1>. Then set <PREFIX>_CURRENT_VERSION
#   in backend/env/$VAULT_ENV.env (printed), commit it and deploy. Older
#   versions stay readable until removed by hand (kv patch KEY=null).
# Generated values and the token go through stdin, never argv or stdout.
set -euo pipefail

: "${VAULT_ADDR:?}" "${VAULT_TOKEN:?}" "${VAULT_ENV:?dev|staging|prod}"
case "$VAULT_ENV" in dev|staging|prod) ;; *) echo "VAULT_ENV must be dev|staging|prod" >&2; exit 2;; esac
action="${1:?usage: rotate-versioned.sh migrate|rotate PREFIX}"
prefix="${2:?usage: rotate-versioned.sh migrate|rotate PREFIX}"
case "$prefix" in
  API_TOKEN_PEPPER|GOOGLE_TOKEN_ENCRYPTION_KEY) ;;
  *) echo "unsupported PREFIX $prefix" >&2; exit 2;;
esac
command -v curl >/dev/null && command -v jq >/dev/null && command -v openssl >/dev/null \
  || { echo "rotate-versioned: curl, jq and openssl are required" >&2; exit 1; }

set_path="secret/data/zenflow/$VAULT_ENV/api"
exec 3<<<"header = \"X-Vault-Token: $VAULT_TOKEN\""
trap 'exec 3<&-' EXIT

read_set() {
  curl -fsS --max-time 15 -K /dev/fd/3 "$VAULT_ADDR/v1/$set_path" | jq -c '.data.data'
}

# patch_set <json on stdin>: merge-patch into the api set. A null value removes the key.
patch_set() {
  curl -fsS --max-time 15 -K /dev/fd/3 -X PATCH \
    -H 'Content-Type: application/merge-patch+json' --data @- \
    "$VAULT_ADDR/v1/$set_path" >/dev/null
}

body="$(read_set)"
current="$(jq -r --arg p "$prefix" '
  [keys[] | select(startswith($p + "_V")) | ltrimstr($p + "_V") | select(test("^[0-9]+$")) | tonumber] | max // 0
' <<<"$body")"

case "$action" in
  migrate)
    if jq -e --arg p "$prefix" 'has($p)' <<<"$body" >/dev/null; then
      [ "$current" = 0 ] || { echo "rotate-versioned: $prefix and ${prefix}_V$current both set; resolve by hand" >&2; exit 1; }
      value="$(jq -r --arg p "$prefix" '.[$p]' <<<"$body")"
      printf '%s' "$value" | jq -Rs --arg new "${prefix}_V1" --arg old "$prefix" \
        '{data: {($new): ., ($old): null}}' | patch_set
      echo "migrated $prefix to ${prefix}_V1 in $VAULT_ENV"
      echo "Deploy the release that reads ${prefix}_V1."
    else
      echo "nothing to migrate: $prefix is not set"
    fi
    ;;
  rotate)
    jq -e --arg p "$prefix" 'has($p) | not' <<<"$body" >/dev/null \
      || { echo "rotate-versioned: $prefix is unversioned; run migrate first" >&2; exit 1; }
    next=$((current + 1))
    openssl rand -hex 32 | tr -d '\n' | jq -Rs --arg k "${prefix}_V$next" '{data: {($k): .}}' | patch_set
    echo "wrote ${prefix}_V$next in $VAULT_ENV"
    echo "Set ${prefix}_CURRENT_VERSION=$next in backend/env/$VAULT_ENV.env, commit and deploy."
    ;;
  *) echo "unknown action $action (migrate|rotate)" >&2; exit 2;;
esac
