#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
# - R2_BUCKET
# - R2_ENDPOINT (e.g. https://<accountid>.r2.cloudflarestorage.com)
# - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# Optional:
# - UPDATE_BASE_PREFIX (default: updates)
# - MAKE_DIR (default: out/make)

R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required}"
R2_ENDPOINT="${R2_ENDPOINT:?R2_ENDPOINT is required}"
UPDATE_BASE_PREFIX="${UPDATE_BASE_PREFIX:-updates}"
MAKE_DIR="${MAKE_DIR:-out/make}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

upload_file() {
  local file="$1"
  local platform="$2"
  local arch="$3"
  local key="${UPDATE_BASE_PREFIX}/${platform}/${arch}/$(basename "$file")"
  echo "Uploading $file -> s3://${R2_BUCKET}/${key}"
  aws s3 cp "$file" "s3://${R2_BUCKET}/${key}" --endpoint-url "$R2_ENDPOINT"
}

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
    upload_file "$file" "win32" "$arch"
    continue
  fi

  if [[ "$normalized" == *"/zip/darwin/"*"/RELEASES.json" ]] || [[ "$normalized" == *"/zip/darwin/"*".zip" ]]; then
    if [[ "$normalized" =~ /zip/darwin/([^/]+)/ ]]; then
      arch="${BASH_REMATCH[1]}"
      upload_file "$file" "darwin" "$arch"
    fi
    continue
  fi
done < <(find "$MAKE_DIR" -type f \( -name "RELEASES" -o -name "*.nupkg" -o -name "*Setup*.exe" -o -name "RELEASES.json" -o -name "*.zip" \))

echo "Done. Uploaded update artifacts from ${MAKE_DIR} to s3://${R2_BUCKET}/${UPDATE_BASE_PREFIX}/<platform>/<arch>/"
