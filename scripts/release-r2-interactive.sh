#!/usr/bin/env bash
set -euo pipefail

# Interactive release wizard:
# - validates local state
# - bumps package.json version
# - optional build (electron-forge make)
# - optional upload to R2 (active + archive)
# - optional post-check of remote files

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1" >&2
    exit 1
  fi
}

confirm() {
  local prompt="$1"
  local default="${2:-Y}"
  local answer
  if [[ "$default" == "Y" ]]; then
    read -r -p "$prompt [Y/n]: " answer
    answer="${answer:-Y}"
    [[ "$answer" =~ ^[Yy]$ ]]
  else
    read -r -p "$prompt [y/N]: " answer
    answer="${answer:-N}"
    [[ "$answer" =~ ^[Yy]$ ]]
  fi
}

ensure_env() {
  local name="$1"
  local current="${!name:-}"
  if [[ -n "$current" ]]; then
    export "$name=$current"
    return
  fi
  read -r -p "Enter ${name}: " value
  if [[ -z "$value" ]]; then
    echo "❌ ${name} is required" >&2
    exit 1
  fi
  export "$name=$value"
}

validate_semver() {
  local version="$1"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]
}

current_version() {
  node -p "require('./package.json').version"
}

bump_version_node() {
  local kind="$1"
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
  ' "$kind"
}

set_version_node() {
  local target="$1"
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
  ' "$target"
}

require_cmd bun
require_cmd node
require_cmd aws
require_cmd git

# Optional local env file (do not commit)
if [[ -f ".env.updates" ]]; then
  # shellcheck disable=SC1091
  source .env.updates
fi

echo "🚀 TarsDB Release Wizard (R2)"
echo "--------------------------------"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠️  Working tree has uncommitted changes."
  if ! confirm "Continue anyway?" "N"; then
    echo "Aborted."
    exit 0
  fi
fi

CURRENT_VERSION="$(current_version)"
echo "Current version: ${CURRENT_VERSION}"
echo

echo "Choose release action:"
echo "  1) Bump patch"
echo "  2) Bump minor"
echo "  3) Bump major"
echo "  4) Set custom version"
echo "  5) Keep current version (build/upload only)"
read -r -p "Option [1-5]: " RELEASE_ACTION

case "$RELEASE_ACTION" in
  1) bump_version_node "patch" ;;
  2) bump_version_node "minor" ;;
  3) bump_version_node "major" ;;
  4)
    read -r -p "Enter target version (e.g. 0.2.0): " TARGET_VERSION
    if ! validate_semver "$TARGET_VERSION"; then
      echo "❌ Invalid semver: $TARGET_VERSION" >&2
      exit 1
    fi
    set_version_node "$TARGET_VERSION"
    ;;
  5) ;;
  *) echo "❌ Invalid option"; exit 1 ;;
esac

NEW_VERSION="$(current_version)"
echo "Selected version: ${NEW_VERSION}"

echo
BUILD_MODE="none"
if confirm "Run build now (bun run make)?" "Y"; then
  BUILD_MODE="make"
fi

UPLOAD_MODE="no"
if confirm "Upload artifacts to R2 now?" "Y"; then
  UPLOAD_MODE="yes"
fi

DRY_RUN="no"
if [[ "$UPLOAD_MODE" == "yes" ]] && confirm "Dry-run upload (show only, no upload)?" "N"; then
  DRY_RUN="yes"
fi

echo
if confirm "Show release plan before execution?" "Y"; then
  echo "\n📋 Release plan"
  echo "- version: ${NEW_VERSION}"
  echo "- build: ${BUILD_MODE}"
  echo "- upload: ${UPLOAD_MODE}"
  echo "- dry-run: ${DRY_RUN}"
  echo
fi

if ! confirm "Execute this plan?" "Y"; then
  echo "Aborted."
  exit 0
fi

if [[ "$BUILD_MODE" == "make" ]]; then
  echo "\n🏗️  Building artifacts..."
  bun run make
fi

if [[ "$UPLOAD_MODE" == "yes" ]]; then
  ensure_env "R2_BUCKET"
  ensure_env "R2_ENDPOINT"
  ensure_env "AWS_ACCESS_KEY_ID"
  ensure_env "AWS_SECRET_ACCESS_KEY"

  export UPDATE_BASE_PREFIX="${UPDATE_BASE_PREFIX:-updates}"
  export UPDATE_ARCHIVE_PREFIX="${UPDATE_ARCHIVE_PREFIX:-updates-archive}"

  echo "\n☁️  Uploading to R2..."
  if [[ "$DRY_RUN" == "yes" ]]; then
    DRY_RUN=1 APP_VERSION="$NEW_VERSION" bash scripts/upload-r2-updates.sh
  else
    APP_VERSION="$NEW_VERSION" bash scripts/upload-r2-updates.sh
  fi

  if confirm "Validate remote listing after upload?" "Y"; then
    echo "\n🔎 Active path"
    aws s3 ls "s3://${R2_BUCKET}/${UPDATE_BASE_PREFIX}/darwin/" --recursive --endpoint-url "$R2_ENDPOINT" | tail -n 20 || true
    echo "\n🔎 Archive path"
    aws s3 ls "s3://${R2_BUCKET}/${UPDATE_ARCHIVE_PREFIX}/v${NEW_VERSION}/darwin/" --recursive --endpoint-url "$R2_ENDPOINT" | tail -n 20 || true
  fi
fi

echo "\n✅ Done"
echo "Next steps:"
echo "  git add package.json bun.lock"
echo "  git commit -m 'chore(release): v${NEW_VERSION}'"
echo "  git push"
