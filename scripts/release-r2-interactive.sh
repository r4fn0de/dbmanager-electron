#!/usr/bin/env bash
set -euo pipefail

# Interactive release helper:
# - bumps package.json version
# - runs forge make
# - uploads update artifacts to R2 (active + archive)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd bun
require_cmd node
require_cmd aws

CURRENT_VERSION="$(node -p "require('./package.json').version")"

echo "Current version: ${CURRENT_VERSION}"
echo
echo "Select version bump:"
echo "  1) patch"
echo "  2) minor"
echo "  3) major"
echo "  4) custom"
read -r -p "Option [1-4]: " VERSION_OPTION

case "$VERSION_OPTION" in
  1) BUMP_KIND="patch" ;;
  2) BUMP_KIND="minor" ;;
  3) BUMP_KIND="major" ;;
  4) BUMP_KIND="custom" ;;
  *) echo "Invalid option"; exit 1 ;;
esac

if [[ "$BUMP_KIND" == "custom" ]]; then
  read -r -p "Enter version (e.g. 0.1.0): " TARGET_VERSION
  if [[ -z "$TARGET_VERSION" ]]; then
    echo "Version is required" >&2
    exit 1
  fi
  bun version "$TARGET_VERSION" --no-git-tag-version
else
  bun version "$BUMP_KIND" --no-git-tag-version
fi

NEW_VERSION="$(node -p "require('./package.json').version")"
echo "New version: ${NEW_VERSION}"

echo
echo "Run build now (bun run make)?"
read -r -p "[Y/n]: " BUILD_ANSWER
BUILD_ANSWER="${BUILD_ANSWER:-Y}"
if [[ "$BUILD_ANSWER" =~ ^[Yy]$ ]]; then
  bun run make
fi

echo
echo "Upload artifacts to R2 now?"
read -r -p "[Y/n]: " UPLOAD_ANSWER
UPLOAD_ANSWER="${UPLOAD_ANSWER:-Y}"
if [[ "$UPLOAD_ANSWER" =~ ^[Yy]$ ]]; then
  APP_VERSION="$NEW_VERSION" bun run upload:updates:r2
fi

echo
echo "Release preparation complete."
echo "Next recommended steps:"
echo "  git add package.json bun.lock"
echo "  git commit -m 'chore(release): v${NEW_VERSION}'"
echo "  git push"
