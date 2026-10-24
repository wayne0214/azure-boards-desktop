#!/usr/bin/env bash
# Builds a release on this Mac from a version tag and uploads it to a draft GitHub release.
#
#   git fetch --tags && git checkout v1.2.0
#   ./scripts/release-local.sh v1.2.0                    # macOS only
#   ./scripts/release-local.sh v1.2.0 --windows <dir>    # also attach a Windows build made from the same tag
#
# The Windows installer usually comes from the Build Windows workflow instead, run on the same tag before or after
# this; each adds its own entry to the release's latest.json.
#
# The tag comes from the Version Bump workflow (see docs/RELEASING.md). The draft gets the universal .dmg,
# the signed update bundle and latest.json; installed copies update once you publish it.
#
# Needs, in this terminal:
#   - the Developer ID certificate in your Keychain (tauri.conf.json names it)
#   - APPLE_ID, APPLE_PASSWORD (app-specific password) and APPLE_TEAM_ID, for notarization
#   - the updater key: ~/.tauri/boards.key and boards.key.pub, or TAURI_SIGNING_PRIVATE_KEY and UPDATER_PUBKEY;
#     TAURI_SIGNING_PRIVATE_KEY_PASSWORD is asked for when not set
#   - gh, signed in with write access to the repository
# --windows <dir> takes the folder holding Boards_<version>_x64-setup.exe and its .sig, built on Windows from the
# same tag with the same updater key (see docs/RELEASING.md, "Windows").
set -euo pipefail

TAG="${1:-}"
shift || true
WIN_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --windows) WIN_DIR="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. $2"; exit 1; }; }
need node "Install Node 22+ from https://nodejs.org"
need cargo "Install Rust from https://rustup.rs"
need gh "Install the GitHub CLI: brew install gh, then gh auth login"
need xcrun "Install Xcode Command Line Tools: xcode-select --install"

case "$TAG" in
  v[0-9]*) ;;
  *) echo "Usage: $0 vX.Y.Z [--windows <dir>]"; exit 1 ;;
esac
VERSION="${TAG#v}"
if [ "$(uname -s)" != "Darwin" ]; then echo "Run this on macOS."; exit 1; fi

# Build exactly what was tagged: the tag's commit, nothing uncommitted, and the version it names.
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "No tag $TAG here. Run: git fetch --tags"; exit 1; }
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$TAG^{commit}")" ]; then
  echo "HEAD is not $TAG. Run: git checkout $TAG"; exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "There are uncommitted changes. Commit or stash them, then try again."; exit 1
fi
PKG_VERSION="$(node -p 'require("./package.json").version')"
if [ "$PKG_VERSION" != "$VERSION" ]; then
  echo "package.json says $PKG_VERSION, but the tag is $TAG."; exit 1
fi

MISSING=()
for v in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || MISSING+=("$v")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Notarization needs ${MISSING[*]} (use export, see docs/RELEASING.md)."; exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/boards.key}"
if [ -z "${UPDATER_PUBKEY:-}" ] && [ -f "$HOME/.tauri/boards.key.pub" ]; then
  UPDATER_PUBKEY="$(cat "$HOME/.tauri/boards.key.pub")"
fi
if [ -z "${UPDATER_PUBKEY:-}" ]; then
  echo "No updater public key: set UPDATER_PUBKEY or create ~/.tauri/boards.key.pub (see docs/RELEASING.md)."; exit 1
fi
case "$TAURI_SIGNING_PRIVATE_KEY" in
  /*|~*) [ -f "$TAURI_SIGNING_PRIVATE_KEY" ] || { echo "No updater key at $TAURI_SIGNING_PRIVATE_KEY."; exit 1; } ;;
esac
if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+set}" ]; then
  read -r -s -p "Updater key password: " TAURI_SIGNING_PRIVATE_KEY_PASSWORD; echo
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
ENDPOINT="${UPDATER_ENDPOINT:-https://github.com/$REPO/releases/latest/download/latest.json}"
# The updater refuses a non-https feed at startup, which would stop the app from opening at all.
case "$ENDPOINT" in https://*) ;; *) echo "UPDATER_ENDPOINT must start with https://"; exit 1 ;; esac

WIN_EXE=""
if [ -n "$WIN_DIR" ]; then
  WIN_EXE="$WIN_DIR/Boards_${VERSION}_x64-setup.exe"
  [ -f "$WIN_EXE" ] && [ -f "$WIN_EXE.sig" ] || { echo "Expected $WIN_EXE and its .sig."; exit 1; }
fi

if [ ! -d node_modules ]; then
  echo "Installing npm dependencies…"
  npm ci
fi
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

# Same release-only overrides the CI build used: updater artifacts, the public key and the feed.
CONF="src-tauri/tauri.release.conf.json"
trap 'rm -f "$CONF"' EXIT
PUBKEY="$UPDATER_PUBKEY" ENDPOINT="$ENDPOINT" node -e '
  const conf = { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: process.env.PUBKEY, endpoints: [process.env.ENDPOINT] } } }
  require("fs").writeFileSync(process.argv[1], JSON.stringify(conf))
' "$CONF"

echo "Building, signing and notarizing Boards $VERSION (universal)…"
npx tauri build --target universal-apple-darwin --bundles app,dmg --config "$CONF"

BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle"
OUT="src-tauri/target/release-$TAG"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$BUNDLE/dmg/Boards_${VERSION}_universal.dmg" "$OUT/"
cp "$BUNDLE/macos/Boards.app.tar.gz" "$OUT/Boards_${VERSION}_universal.app.tar.gz"
cp "$BUNDLE/macos/Boards.app.tar.gz.sig" "$OUT/Boards_${VERSION}_universal.app.tar.gz.sig"
if [ -n "$WIN_EXE" ]; then
  cp "$WIN_EXE" "$WIN_EXE.sig" "$OUT/"
fi

# latest.json: what the in-app updater reads. Start from the one already on the release, if any,
# so a Windows entry added by the Build Windows workflow is kept.
gh release download "$TAG" --pattern latest.json --dir "$OUT" 2>/dev/null || true
URL="https://github.com/$REPO/releases/download/$TAG"
MAC="Boards_${VERSION}_universal.app.tar.gz"
ENTRIES=(darwin-aarch64 "$URL/$MAC" "$OUT/$MAC.sig" darwin-x86_64 "$URL/$MAC" "$OUT/$MAC.sig")
if [ -n "$WIN_EXE" ]; then
  WIN="Boards_${VERSION}_x64-setup.exe"
  ENTRIES+=(windows-x86_64 "$URL/$WIN" "$OUT/$WIN.sig")
fi
node scripts/latest-json.mjs "$OUT/latest.json" "$VERSION" "See https://github.com/$REPO/releases/tag/$TAG" "${ENTRIES[@]}"

FILES=("$OUT"/*)
PRERELEASE=()
case "$VERSION" in *-*) PRERELEASE=(--prerelease) ;; esac
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Updating the existing release ${TAG}…"
  gh release upload "$TAG" "${FILES[@]}" --clobber
else
  # The ${…+…} form: macOS's bash 3.2 treats an empty array as unset under set -u.
  gh release create "$TAG" "${FILES[@]}" --verify-tag --draft ${PRERELEASE[@]+"${PRERELEASE[@]}"} --title "Boards $TAG" --generate-notes
fi

echo
echo "Done. Check the draft, then publish it: https://github.com/$REPO/releases/tag/$TAG"
if [ -z "$WIN_EXE" ] && ! grep -q windows-x86_64 "$OUT/latest.json"; then
  echo "No Windows build yet: run Build Windows from the Actions tab on $TAG (see docs/RELEASING.md) before publishing."
fi
