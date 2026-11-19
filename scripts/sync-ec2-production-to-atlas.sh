#!/usr/bin/env bash
#
# Copy the full MongoDB database from EC2 production into MongoDB Atlas.
# Uses mongodump + mongorestore (MongoDB Database Tools). Run on your laptop
# (with network/SSH tunnel to EC2) or directly on the EC2 host.
#
# .env (backend):
#   MONGODB_EC2_URL     — source (e.g. mongodb://127.0.0.1:27017/handkerchief on EC2)
#   MONGODB_ATLAS_URL   — target (e.g. mongodb+srv://…/test?…)
#
# Examples:
#   # Preview: dump only, no write to Atlas
#   ./scripts/sync-ec2-production-to-atlas.sh --dry-run
#
#   # Full replace on Atlas (drops collections in target DB, then restores)
#   ./scripts/sync-ec2-production-to-atlas.sh --confirm
#
#   # Explicit URIs (overrides .env)
#   ./scripts/sync-ec2-production-to-atlas.sh --confirm \
#     "mongodb://127.0.0.1:27017/handkerchief" \
#     "mongodb+srv://user:pass@cluster/dbname?retryWrites=true"
#
# SSH tunnel (from laptop when Mongo on EC2 is not public):
#   ssh -N -L 27018:127.0.0.1:27017 user@your-ec2-host
#   MONGODB_EC2_URL=mongodb://127.0.0.1:27018/handkerchief ./scripts/sync-ec2-production-to-atlas.sh --confirm
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_DIR="$ROOT/mongo-dump/ec2-to-atlas-$STAMP"

CONFIRM=0
DRY_RUN=0
SOURCE_URI=""
TARGET_URI=""

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  echo ""
  echo "Options:"
  echo "  --confirm     Required to restore into Atlas (--drop on target DB)."
  echo "  --dry-run     Dump from EC2 only; do not restore."
  echo "  -h, --help    Show this help."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    mongodb*|mongodb+*) 
      if [[ -z "$SOURCE_URI" ]]; then SOURCE_URI="$1"; elif [[ -z "$TARGET_URI" ]]; then TARGET_URI="$1"; else echo "Too many URI arguments"; exit 1; fi
      shift
      ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(MONGODB_EC2_URL|MONGODB_ATLAS_URL)=' "$ROOT/.env" || true)
  set +a
fi

SOURCE_URI="${SOURCE_URI:-${MONGODB_EC2_URL:-}}"
TARGET_URI="${TARGET_URI:-${MONGODB_ATLAS_URL:-}}"

if [[ -z "$SOURCE_URI" ]]; then
  echo "Set MONGODB_EC2_URL in .env or pass the source URI as the first argument."
  exit 1
fi
if [[ -z "$TARGET_URI" && "$DRY_RUN" -eq 0 ]]; then
  echo "Set MONGODB_ATLAS_URL in .env or pass the target URI as the second argument."
  exit 1
fi

for bin in mongodump mongorestore; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing $bin. Install MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/"
    exit 1
  fi
done

# Database name from URI path (segment after host, before ?).
db_name_from_uri() {
  local uri="$1"
  local db
  db="$(echo "$uri" | sed -E 's/^mongodb(\+srv)?:\/\/[^/]+\/([^/?]+).*/\2/')"
  if [[ -z "$db" || "$db" == "$uri" ]]; then
    return 1
  fi
  echo "$db"
}

SOURCE_DB="$(db_name_from_uri "$SOURCE_URI")" || {
  echo "Source URI must include a database name, e.g. mongodb://host:27017/handkerchief"
  exit 1
}

TARGET_DB=""
if [[ -n "$TARGET_URI" ]]; then
  TARGET_DB="$(db_name_from_uri "$TARGET_URI")" || {
    echo "Target URI must include a database name, e.g. mongodb+srv://…/test?…"
    exit 1
  }
fi

mask_uri() {
  echo "$1" | sed -E 's#(//)[^:@/]+:[^@]+@#\1***:***@#'
}

echo "Source: $(mask_uri "$SOURCE_URI") (db: $SOURCE_DB)"
if [[ -n "$TARGET_URI" ]]; then
  echo "Target: $(mask_uri "$TARGET_URI") (db: $TARGET_DB)"
fi
echo "Dump folder: $DUMP_DIR"

mkdir -p "$DUMP_DIR"
echo "Dumping EC2 production…"
mongodump --uri="$SOURCE_URI" --out="$DUMP_DIR"

DUMP_SUB="$DUMP_DIR/$SOURCE_DB"
if [[ ! -d "$DUMP_SUB" ]]; then
  echo "Expected dump at $DUMP_SUB — check source URI and connectivity."
  exit 1
fi

COLLECTION_COUNT="$(find "$DUMP_SUB" -maxdepth 1 -name '*.bson' 2>/dev/null | wc -l | tr -d ' ')"
echo "Dumped $COLLECTION_COUNT collections from $SOURCE_DB."

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run complete. No changes on Atlas."
  exit 0
fi

if [[ "$CONFIRM" -ne 1 ]]; then
  echo ""
  echo "Refusing to restore without --confirm."
  echo "This will --drop every collection in Atlas database \"$TARGET_DB\" and replace with EC2 data."
  echo "Re-run: $0 --confirm"
  exit 2
fi

echo "Restoring into Atlas (drop + replace)…"
RESTORE_ARGS=(--drop --uri="$TARGET_URI" "$DUMP_SUB")
if [[ "$SOURCE_DB" != "$TARGET_DB" ]]; then
  RESTORE_ARGS=(--drop --uri="$TARGET_URI" --nsFrom="${SOURCE_DB}.*" --nsTo="${TARGET_DB}.*" "$DUMP_SUB")
  echo "Namespace map: ${SOURCE_DB}.* → ${TARGET_DB}.*"
fi

mongorestore "${RESTORE_ARGS[@]}"

echo "Done. Atlas database \"$TARGET_DB\" now matches EC2 \"$SOURCE_DB\" ($COLLECTION_COUNT collections)."
echo "Dump kept at: $DUMP_DIR"