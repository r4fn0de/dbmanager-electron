#!/usr/bin/env bash
set -euo pipefail

# CI-only update release trigger.
# This script intentionally does NOT build or upload locally.
# It only dispatches .github/workflows/publish.yaml.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gh
require_cmd git

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit/push before triggering CI release." >&2
  exit 1
fi

RELEASE_NOTES="${1:-}"
if [[ -z "$RELEASE_NOTES" ]]; then
  read -r -p "Release notes (optional): " RELEASE_NOTES
fi

echo "Dispatching workflow: .github/workflows/publish.yaml"
gh workflow run ".github/workflows/publish.yaml" -f "release_notes=${RELEASE_NOTES}"
echo "Done. Track with: gh run list --workflow publish.yaml --limit 1"
