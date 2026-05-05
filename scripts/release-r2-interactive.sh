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

# Optional local env file for release/upload secrets (do not commit)
if [[ -f ".env.updates" ]]; then
  # shellcheck disable=SC1091
  source .env.updates
fi

ensure_env() {
  local name="$1"
  local current="${!name:-}"
  if [[ -n "$current" ]]; then
    # Guarantee it is exported for child processes.
    export "$name=$current"
    return
  fi
  read -r -p "Enter ${name}: " value
  if [[ -z "$value" ]]; then
    echo "${name} is required" >&2
    exit 1
  fi
  export "$name=$value"
}

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
  node -e '
    const fs = require("fs");
    const path = "package.json";
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    const target = process.argv[1];
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(target)) {
      console.error("Invalid semver:", target);
      process.exit(1);
    }
    pkg.version = target;
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  ' "$TARGET_VERSION"
else
  node -e '
    const fs = require("fs");
    const path = "package.json";
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    const [major, minor, patch] = pkg.version.split(".").map(Number);
    if (![major, minor, patch].every(Number.isFinite)) {
      console.error("Current version is not valid semver:", pkg.version);
      process.exit(1);
    }
    const kind = process.argv[1];
    let next = [major, minor, patch];
    if (kind === "patch") next = [major, minor, patch + 1];
    else if (kind === "minor") next = [major, minor + 1, 0];
    else if (kind === "major") next = [major + 1, 0, 0];
    else {
      console.error("Invalid bump kind:", kind);
      process.exit(1);
    }
    pkg.version = next.join(".");
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  ' "$BUMP_KIND"
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
  ensure_env "R2_BUCKET"
  ensure_env "R2_ENDPOINT"
  ensure_env "AWS_ACCESS_KEY_ID"
  ensure_env "AWS_SECRET_ACCESS_KEY"

  # Optional defaults
  export UPDATE_BASE_PREFIX="${UPDATE_BASE_PREFIX:-updates}"
  export UPDATE_ARCHIVE_PREFIX="${UPDATE_ARCHIVE_PREFIX:-updates-archive}"

  APP_VERSION="$NEW_VERSION" bash scripts/upload-r2-updates.sh
fi

echo
echo "Release preparation complete."
echo "Next recommended steps:"
echo "  git add package.json bun.lock"
echo "  git commit -m 'chore(release): v${NEW_VERSION}'"
echo "  git push"
