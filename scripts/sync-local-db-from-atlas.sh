#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_DIR="$ROOT/mongo-dump/atlas-$STAMP"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(MONGODB_ATLAS_URL|MONGODB_URL)=' "$ROOT/.env")
  set +a
fi

ATLAS_URI="${MONGODB_ATLAS_URL:?Set MONGODB_ATLAS_URL in .env}"
LOCAL_URI="${MONGODB_URL:-mongodb://127.0.0.1:27017/handkerchief}"

echo "Dumping Atlas (test) → $DUMP_DIR"
mongodump --uri="$ATLAS_URI" --out="$DUMP_DIR"

echo "Restoring into local handkerchief"
mongorestore --drop --uri="mongodb://127.0.0.1:27017" \
  --nsFrom="test.*" \
  --nsTo="handkerchief.*" \
  "$DUMP_DIR"

echo "Done. Set MONGODB_URL=$LOCAL_URI in .env for development."