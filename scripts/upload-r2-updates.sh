#!/usr/bin/env bash
set -euo pipefail

# Uploads Electron Forge update artifacts to Cloudflare R2 in 2 locations:
# 1) Active channel:  <prefix>/<platform>/<arch>/...
# 2) Version archive: <archive_prefix>/v<version>/<platform>/<arch>/...
#
# Required env vars:
# - R2_BUCKET
# - R2_ENDPOINT (e.g. https://<accountid>.r2.cloudflarestorage.com)
# - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#
# Optional env vars:
# - UPDATE_BASE_PREFIX (default: updates)
# - UPDATE_ARCHIVE_PREFIX (default: updates-archive)
# - MAKE_DIR (default: out/make)
# - APP_VERSION (default: package.json version)

R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required}"
R2_ENDPOINT="${R2_ENDPOINT:?R2_ENDPOINT is required}"
UPDATE_BASE_PREFIX="${UPDATE_BASE_PREFIX:-updates}"
UPDATE_ARCHIVE_PREFIX="${UPDATE_ARCHIVE_PREFIX:-updates-archive}"
MAKE_DIR="${MAKE_DIR:-out/make}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

if [[ -n "${APP_VERSION:-}" ]]; then
  VERSION="$APP_VERSION"
else
  VERSION="$(node -p "require('./package.json').version")"
fi

upload_to_key() {
  local file="$1"
  local key="$2"
  echo "Uploading $file -> s3://${R2_BUCKET}/${key}"
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    return
  fi
  aws s3 cp "$file" "s3://${R2_BUCKET}/${key}" --endpoint-url "$R2_ENDPOINT"
}

upload_active_and_archive() {
  local file="$1"
  local platform="$2"
  local arch="$3"
  local filename
  filename="$(basename "$file")"

  local active_key="${UPDATE_BASE_PREFIX}/${platform}/${arch}/${filename}"
  local archive_key="${UPDATE_ARCHIVE_PREFIX}/v${VERSION}/${platform}/${arch}/${filename}"

  upload_to_key "$file" "$active_key"
  upload_to_key "$file" "$archive_key"
}

echo "Using version: v${VERSION}"
echo "Scanning artifacts in: ${MAKE_DIR}"

# update-electron-app static storage needs:
# - Windows: RELEASES + *.nupkg (+ Setup.exe)
# - macOS: RELEASES.json + *.zip
while IFS= read -r file; do
  normalized="${file//\\/\/}"

  if [[ "$normalized" == *"/squirrel.windows/"*"/RELEASES" ]] || [[ "$normalized" == *.nupkg ]] || [[ "$normalized" == *Setup*.exe ]]; then
    if [[ "$normalized" =~ /squirrel\.windows/([^/]+)/ ]]; then
      arch="${BASH_REMATCH[1]}"
    else
      arch="x64"
    fi
    upload_active_and_archive "$file" "win32" "$arch"
    continue
  fi

  if [[ "$normalized" == *"/zip/darwin/"*"/RELEASES.json" ]] || [[ "$normalized" == *"/zip/darwin/"*".zip" ]]; then
    if [[ "$normalized" =~ /zip/darwin/([^/]+)/ ]]; then
      arch="${BASH_REMATCH[1]}"
      upload_active_and_archive "$file" "darwin" "$arch"
    fi
    continue
  fi
done < <(find "$MAKE_DIR" -type f \( -name "RELEASES" -o -name "*.nupkg" -o -name "*Setup*.exe" -o -name "RELEASES.json" -o -name "*.zip" \))

echo "Done."
echo "Active path:   s3://${R2_BUCKET}/${UPDATE_BASE_PREFIX}/<platform>/<arch>/"
echo "Archive path:  s3://${R2_BUCKET}/${UPDATE_ARCHIVE_PREFIX}/v${VERSION}/<platform>/<arch>/"
