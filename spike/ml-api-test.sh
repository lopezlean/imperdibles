#!/usr/bin/env bash
# THROWAWAY SPIKE: checks what the Mercado Libre API returns with an app token.
# Usage:
#   ./ml-api-test.sh auth-url        print the URL to authorize the app
#   ./ml-api-test.sh token <code>    exchange the authorization code for a token
#   ./ml-api-test.sh probe [query]   call the endpoints we care about
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing spike/.env with ML_APP_ID, ML_CLIENT_SECRET and ML_REDIRECT_URI"; exit 1; }
# shellcheck disable=SC1091
source .env
: "${ML_APP_ID:?}" "${ML_CLIENT_SECRET:?}" "${ML_REDIRECT_URI:?}"

API="https://api.mercadolibre.com"
TOKEN_FILE=".token"

json_get() { python3 -c "import sys,json
d=json.load(sys.stdin)
for k in sys.argv[1].split('.'):
    d=d[int(k)] if isinstance(d,list) else d.get(k) if isinstance(d,dict) else None
    if d is None: break
print('' if d is None else d)" "$1" 2>/dev/null || true; }

call() { # call <label> <path>; prints status + short body, leaves body in $BODY_FILE
  local label="$1" path="$2" code
  code=$(curl -s -o "$BODY_FILE" -w "%{http_code}" -H "Authorization: Bearer $(<"$TOKEN_FILE")" "$API$path")
  printf '\n[%s] %s -> HTTP %s\n' "$label" "$path" "$code"
  head -c 400 "$BODY_FILE"; echo
}

case "${1:-}" in
  auth-url)
    echo "https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${ML_APP_ID}&redirect_uri=${ML_REDIRECT_URI}"
    ;;
  token)
    code="${2:?pass the code from the redirect URL}"
    resp=$(curl -s -X POST "$API/oauth/token" \
      -H "accept: application/json" -H "content-type: application/x-www-form-urlencoded" \
      --data-urlencode "grant_type=authorization_code" \
      --data-urlencode "client_id=${ML_APP_ID}" \
      --data-urlencode "client_secret=${ML_CLIENT_SECRET}" \
      --data-urlencode "code=${code}" \
      --data-urlencode "redirect_uri=${ML_REDIRECT_URI}")
    token=$(printf '%s' "$resp" | json_get access_token)
    if [ -z "$token" ]; then echo "Token exchange failed:"; echo "$resp"; exit 1; fi
    (umask 077; printf '%s' "$token" > "$TOKEN_FILE")
    echo "Token saved to spike/$TOKEN_FILE (expires in $(printf '%s' "$resp" | json_get expires_in)s)"
    ;;
  probe)
    [ -f "$TOKEN_FILE" ] || { echo "No token yet: run 'token <code>' first"; exit 1; }
    q="${2:-aspiradora robot xiaomi s40c}"
    enc=$(python3 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))" "$q")
    BODY_FILE=$(mktemp); trap 'rm -f "$BODY_FILE"' EXIT

    call "who am I" "/users/me?attributes=id,nickname,site_id"
    call "listing search" "/sites/MLA/search?q=${enc}&limit=3"
    listing_item=$(json_get results.0.id < "$BODY_FILE")
    call "catalog search" "/products/search?site_id=MLA&status=active&q=${enc}&limit=3"
    product=$(json_get results.0.id < "$BODY_FILE")

    if [ -n "$product" ]; then
      call "catalog product" "/products/${product}"
      call "catalog product offers" "/products/${product}/items"
      offer_item=$(json_get results.0.item_id < "$BODY_FILE")
      echo "  first offer price: $(json_get results.0.price < "$BODY_FILE")"
    fi
    item="${listing_item:-${offer_item:-}}"
    if [ -n "$item" ]; then
      call "item detail" "/items/${item}?attributes=id,title,price,original_price,permalink,seller_id"
      call "item prices" "/items/${item}/prices"
    else
      echo; echo "No item id found from either search; nothing to fetch on /items."
    fi
    ;;
  *)
    sed -n '2,6p' "$0"; exit 1 ;;
esac
