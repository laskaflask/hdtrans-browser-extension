#!/usr/bin/env bash
# Installs Mozilla's Firefox build for the E2E tests (tests/e2e/run.mjs) on Linux, e.g. as the
# setup script of a Claude Code cloud environment. Self-contained, so it can be pasted as is.
#
# FIREFOX_VERSION: a release such as 142.0 (default: latest)
# FIREFOX_DIR: where to unpack it (default: /opt/firefox); firefox is linked into /usr/local/bin.
#
# Needs network access to download.mozilla.org and download-installer.cdn.mozilla.net.
set -euo pipefail

version=${FIREFOX_VERSION:-latest}
dir=${FIREFOX_DIR:-/opt/firefox}
case "$(uname -m)" in
  x86_64) os=linux64 ;;
  aarch64 | arm64) os=linux64-aarch64 ;;
  *) echo "install-firefox: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

if [ "$version" != latest ] && [ -x "$dir/firefox" ] &&
  [ "$("$dir/firefox" --version 2>/dev/null)" = "Mozilla Firefox $version" ]; then
  echo "install-firefox: Firefox $version is already in $dir"
  exit 0
fi

# Firefox ships as .tar.xz (older releases as .tar.bz2); tar needs xz or bzip2 to unpack.
if ! command -v xz > /dev/null || ! command -v bzip2 > /dev/null; then
  apt-get update -qq && apt-get install -y -qq xz-utils bzip2 > /dev/null
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL --retry 3 -o "$work/firefox.tar" \
  "https://download.mozilla.org/?product=firefox-$version-ssl&os=$os&lang=en-US"
tar -xf "$work/firefox.tar" -C "$work"
rm -rf "$dir"
mkdir -p "$(dirname "$dir")"
mv "$work/firefox" "$dir"
ln -sf "$dir/firefox" /usr/local/bin/firefox

# The system libraries Firefox needs to start headless, if the image lacks them (the libraries
# Firefox bundles are found next to libxul.so). Ubuntu 24.04 renamed some with a t64 suffix.
if LD_LIBRARY_PATH="$dir" ldd "$dir/libxul.so" | grep -q 'not found'; then
  apt-get update -qq
  apt-get install -y -qq libgtk-3-0t64 libasound2t64 libdbus-glib-1-2 libx11-xcb1 libxtst6 > /dev/null 2>&1 ||
    apt-get install -y -qq libgtk-3-0 libasound2 libdbus-glib-1-2 libx11-xcb1 libxtst6 > /dev/null
fi

echo "install-firefox: $("$dir/firefox" --version) → $dir"
