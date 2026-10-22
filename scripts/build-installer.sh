#!/usr/bin/env bash
# Builds a release installer for the current platform.
#
#   ./scripts/build-installer.sh mac      -> .dmg and .app   (run on macOS)
#   ./scripts/build-installer.sh win      -> NSIS .exe       (run on Windows via Git Bash / WSL is NOT supported, use build-installer.ps1)
#
# Output lands in src-tauri/target/release/bundle/.
set -euo pipefail

TARGET="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. $2"; exit 1; }; }
need node "Install Node 20+ from https://nodejs.org"
need cargo "Install Rust from https://rustup.rs"

if [ ! -d node_modules ]; then
  echo "Installing npm dependencies…"
  npm ci
fi

case "$TARGET" in
  mac)
    if [ "$(uname -s)" != "Darwin" ]; then echo "The mac installer must be built on macOS."; exit 1; fi
    need xcodebuild "Install Xcode Command Line Tools: xcode-select --install"
    # Notarization needs all three; say up front which are missing rather than after a long build.
    MISSING=()
    for v in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
      [ -n "${!v:-}" ] || MISSING+=("$v")
    done
    if [ ${#MISSING[@]} -gt 0 ]; then
      echo "Not notarizing: ${MISSING[*]} not set in this terminal (use export, see README)."
    fi
    # Universal binary (Apple Silicon + Intel) when both targets are installed; otherwise native arch.
    if rustup target list --installed | grep -q aarch64-apple-darwin && rustup target list --installed | grep -q x86_64-apple-darwin; then
      echo "Building universal macOS app…"
      npx tauri build --target universal-apple-darwin --bundles app,dmg
      OUT="src-tauri/target/universal-apple-darwin/release/bundle"
    else
      echo "Building macOS app for this machine's architecture…"
      echo "(Install both targets for a universal build: rustup target add aarch64-apple-darwin x86_64-apple-darwin)"
      npx tauri build --bundles app,dmg
      OUT="src-tauri/target/release/bundle"
    fi
    echo
    echo "Done. Installer:"
    find "$OUT/dmg" -name '*.dmg' -print
    echo
    if [ ${#MISSING[@]} -eq 0 ]; then
      echo "Notarized: colleagues can open it without any warning."
    else
      echo "Not notarized (missing: ${MISSING[*]}); first launch needs Open Anyway (see README, Building installers)."
    fi
    ;;
  win)
    echo "On Windows run:  powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1"
    exit 1
    ;;
  *)
    echo "Usage: $0 mac|win"
    exit 1
    ;;
esac
