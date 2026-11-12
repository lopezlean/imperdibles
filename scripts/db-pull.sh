#!/usr/bin/env bash
# Copies the production D1 database into the local one that `wrangler dev` serves.
# Read-only against production: it only exports. The local copy is replaced each time.
set -euo pipefail

cd "$(dirname "$0")/.."
DUMP="var/d1-remote.sql"
mkdir -p var

echo "1/3 Exporting remote D1 (read-only)..."
# </dev/null makes wrangler non-interactive: it skips the "database unavailable during export" prompt and answers yes.
pnpm -s wrangler d1 export imperdibles --remote --output "$DUMP" </dev/null

echo "2/3 Resetting the local D1 state..."
rm -rf .wrangler/state/v3/d1

echo "3/3 Loading the dump into local D1..."
pnpm -s wrangler d1 execute imperdibles --local --file "$DUMP" >/dev/null

echo "Done. Run: pnpm worker:dev"
