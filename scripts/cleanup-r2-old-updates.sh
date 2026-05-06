#!/usr/bin/env bash
set -euo pipefail

# Deletes old versioned update archives from R2 to save storage.
#
# Required env vars:
# - R2_BUCKET
# - R2_ENDPOINT
# - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#
# Optional env vars:
# - UPDATE_ARCHIVE_PREFIX (default: updates-archive)
# - KEEP_VERSIONS (default: 2)
# - DRY_RUN (1 = list only, no delete)
# - ALLOW_LOCAL_UPDATE_SCRIPTS=1 (override CI-only guard for emergencies)

if [[ "${CI:-}" != "true" && "${ALLOW_LOCAL_UPDATE_SCRIPTS:-0}" != "1" ]]; then
  echo "Local archive cleanup is disabled. Use CI workflow publish.yaml." >&2
  echo "Override only for emergencies with ALLOW_LOCAL_UPDATE_SCRIPTS=1." >&2
  exit 1
fi

R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required}"
R2_ENDPOINT="${R2_ENDPOINT:?R2_ENDPOINT is required}"
UPDATE_ARCHIVE_PREFIX="${UPDATE_ARCHIVE_PREFIX:-updates-archive}"
KEEP_VERSIONS="${KEEP_VERSIONS:-2}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

if ! [[ "$KEEP_VERSIONS" =~ ^[0-9]+$ ]]; then
  echo "KEEP_VERSIONS must be a number" >&2
  exit 1
fi

mapfile -t VERSION_PREFIXES < <(
  aws s3 ls "s3://${R2_BUCKET}/${UPDATE_ARCHIVE_PREFIX}/" --endpoint-url "$R2_ENDPOINT" \
    | awk '/PRE v/{print $2}' \
    | sed 's#/##g' \
    | sort -V
)

TOTAL="${#VERSION_PREFIXES[@]}"
if (( TOTAL <= KEEP_VERSIONS )); then
  echo "Nothing to clean. total=${TOTAL}, keep=${KEEP_VERSIONS}"
  exit 0
fi

DELETE_COUNT=$((TOTAL - KEEP_VERSIONS))

echo "Found ${TOTAL} archived versions. Keeping newest ${KEEP_VERSIONS}, deleting ${DELETE_COUNT}."

for ((i=0; i<DELETE_COUNT; i++)); do
  VERSION_DIR="${VERSION_PREFIXES[$i]}"
  TARGET="s3://${R2_BUCKET}/${UPDATE_ARCHIVE_PREFIX}/${VERSION_DIR}/"

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "[DRY_RUN] Would delete: ${TARGET}"
  else
    echo "Deleting: ${TARGET}"
    aws s3 rm "$TARGET" --recursive --endpoint-url "$R2_ENDPOINT"
  fi
done

echo "Cleanup done."
