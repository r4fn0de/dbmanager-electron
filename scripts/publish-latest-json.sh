#!/usr/bin/env bash
set -euo pipefail

# Publishes updates/latest.json to Cloudflare R2.
#
# Required env vars:
# - R2_BUCKET
# - R2_ENDPOINT
# - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#
# Optional env vars:
# - UPDATE_BASE_PREFIX (default: updates)
# - UPDATE_ARCHIVE_PREFIX (default: updates-archive)
# - UPDATE_BASE_URL (default: https://update.novon.tech/updates)
# - APP_VERSION (default: package.json version)
# - RELEASE_NOTES (default: empty)
# - MAKE_DIR (default: out/make)
# - LATEST_DOWNLOAD_PATH (relative path after UPDATE_BASE_URL, e.g. darwin/arm64/TarsDB-0.1.2.zip)
# - ALLOW_LOCAL_UPDATE_SCRIPTS=1 (override CI-only guard for emergencies)

if [[ "${CI:-}" != "true" && "${ALLOW_LOCAL_UPDATE_SCRIPTS:-0}" != "1" ]]; then
  echo "Local latest.json publish is disabled. Use CI workflow publish.yaml." >&2
  echo "Override only for emergencies with ALLOW_LOCAL_UPDATE_SCRIPTS=1." >&2
  exit 1
fi

R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required}"
R2_ENDPOINT="${R2_ENDPOINT:?R2_ENDPOINT is required}"
UPDATE_BASE_PREFIX="${UPDATE_BASE_PREFIX:-updates}"
UPDATE_ARCHIVE_PREFIX="${UPDATE_ARCHIVE_PREFIX:-updates-archive}"
UPDATE_BASE_URL="${UPDATE_BASE_URL:-https://update.novon.tech/updates}"
MAKE_DIR="${MAKE_DIR:-out/make}"
RELEASE_NOTES="${RELEASE_NOTES:-}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

if [[ -n "${APP_VERSION:-}" ]]; then
  VERSION="$APP_VERSION"
else
  VERSION="$(node -p "require('./package.json').version")"
fi

DOWNLOAD_PATH="${LATEST_DOWNLOAD_PATH:-}"
if [[ -z "$DOWNLOAD_PATH" ]]; then
  # Prefer darwin/arm64 zip from local build output
  CANDIDATE="$(find "$MAKE_DIR" -type f | grep -E "/zip/darwin/arm64/.*${VERSION}.*\.zip$" | head -n 1 || true)"
  if [[ -z "$CANDIDATE" ]]; then
    # Fallback to any darwin zip with current version
    CANDIDATE="$(find "$MAKE_DIR" -type f | grep -E "/zip/darwin/.*/.*${VERSION}.*\.zip$" | head -n 1 || true)"
  fi

  if [[ -z "$CANDIDATE" ]]; then
    echo "Could not infer download file. Set LATEST_DOWNLOAD_PATH manually." >&2
    exit 1
  fi

  NORMALIZED="${CANDIDATE//\\/\/}"
  if [[ "$NORMALIZED" =~ /zip/darwin/([^/]+)/([^/]+\.zip)$ ]]; then
    ARCH="${BASH_REMATCH[1]}"
    FILE_NAME="${BASH_REMATCH[2]}"
    DOWNLOAD_PATH="darwin/${ARCH}/${FILE_NAME}"
  else
    echo "Failed to parse build artifact path: $CANDIDATE" >&2
    exit 1
  fi
fi

DOWNLOAD_URL="${UPDATE_BASE_URL%/}/${DOWNLOAD_PATH#./}"
PUBLISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Try to infer platform/arch from DOWNLOAD_PATH, e.g. darwin/arm64/MyApp.zip
DOWNLOAD_PLATFORM=""
DOWNLOAD_ARCH=""
if [[ "$DOWNLOAD_PATH" =~ ^([^/]+)/([^/]+)/.+$ ]]; then
  DOWNLOAD_PLATFORM="${BASH_REMATCH[1]}"
  DOWNLOAD_ARCH="${BASH_REMATCH[2]}"
fi

TMP_FILE="$(mktemp)"
EXISTING_FILE="$(mktemp)"

# Merge with existing latest.json (if same version) so we can keep both arch URLs.
aws s3 cp "s3://${R2_BUCKET}/${UPDATE_BASE_PREFIX}/latest.json" "$EXISTING_FILE" --endpoint-url "$R2_ENDPOINT" >/dev/null 2>&1 || true

node -e '
  const fs = require("fs");
  const outPath = process.argv[1];
  const existingPath = process.argv[2];
  const version = process.argv[3];
  const downloadUrl = process.argv[4];
  const notes = process.argv[5];
  const publishedAt = process.argv[6];
  const platform = process.argv[7];
  const arch = process.argv[8];

  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));
  } catch {
    existing = null;
  }

  const downloads = {
    darwin: {},
    win32: {},
  };

  if (existing && existing.version === version && existing.downloads) {
    if (existing.downloads.darwin) {
      downloads.darwin.arm64 = existing.downloads.darwin.arm64 || undefined;
      downloads.darwin.x64 = existing.downloads.darwin.x64 || undefined;
    }
    if (existing.downloads.win32) {
      downloads.win32.arm64 = existing.downloads.win32.arm64 || undefined;
      downloads.win32.x64 = existing.downloads.win32.x64 || undefined;
    }
  }

  if (platform && arch) {
    if (!downloads[platform]) downloads[platform] = {};
    downloads[platform][arch] = downloadUrl;
  }

  const output = {
    version,
    downloadUrl,
    downloads,
    notes,
    publishedAt,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
' "$TMP_FILE" "$EXISTING_FILE" "$VERSION" "$DOWNLOAD_URL" "$RELEASE_NOTES" "$PUBLISHED_AT" "$DOWNLOAD_PLATFORM" "$DOWNLOAD_ARCH"

ACTIVE_KEY="${UPDATE_BASE_PREFIX}/latest.json"
ARCHIVE_KEY="${UPDATE_ARCHIVE_PREFIX}/v${VERSION}/latest.json"

echo "Uploading latest.json -> s3://${R2_BUCKET}/${ACTIVE_KEY}"
aws s3 cp "$TMP_FILE" "s3://${R2_BUCKET}/${ACTIVE_KEY}" --content-type "application/json" --endpoint-url "$R2_ENDPOINT"

echo "Uploading archived latest.json -> s3://${R2_BUCKET}/${ARCHIVE_KEY}"
aws s3 cp "$TMP_FILE" "s3://${R2_BUCKET}/${ARCHIVE_KEY}" --content-type "application/json" --endpoint-url "$R2_ENDPOINT"

rm -f "$TMP_FILE" "$EXISTING_FILE"

echo "Done."
echo "latest.json URL: ${UPDATE_BASE_URL%/}/latest.json"
echo "downloadUrl: ${DOWNLOAD_URL}"
