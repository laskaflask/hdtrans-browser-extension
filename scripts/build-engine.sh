#!/usr/bin/env bash
# Builds the hdTrans WebAssembly engine into vendor/hdtrans/ without dynamic code generation.
#
# The engine in the hdtrans npm package is linked with Emscripten's default
# DYNAMIC_EXECUTION=1, so its embind glue calls `new Function`. Extension pages forbid that
# (Chrome and Firefox alike), so this builds the same release with -sDYNAMIC_EXECUTION=0.
# The dictionary (dicts.hdsnap) still comes from the npm package, which is why the engine is
# built from the tag of the installed package version: snapshots only load in the engine
# build they were compiled with.
#
# Needs git, cmake, ninja and Emscripten $EMSCRIPTEN_VERSION below, the version hdTrans's own CI
# builds with (emsdk install/activate it; another version builds a different engine).
# HDTRANS_SRC: git URL or local clone to build from (default: GitHub).
set -euo pipefail

EMSCRIPTEN_VERSION=4.0.22
emcc_version=$(emcc --version | head -n 1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)
if [ "$emcc_version" != "$EMSCRIPTEN_VERSION" ]; then
  echo "build-engine: needs Emscripten $EMSCRIPTEN_VERSION, found ${emcc_version:-none}" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p "require('$root/node_modules/hdtrans/package.json').version")
src=${HDTRANS_SRC:-https://github.com/sokcuri/hdTrans.git}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone --quiet --depth 1 --branch "v$version" "$src" "$work/src"
emcmake cmake -S "$work/src" -B "$work/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS=-sDYNAMIC_EXECUTION=0 > "$work/configure.log"
cmake --build "$work/build" --target hdtrans_wasm --parallel

out="$root/vendor/hdtrans"
mkdir -p "$out"
cp "$work/build/hdtrans_engine.js" "$work/build/hdtrans_engine.wasm" "$out/"
printf '%s\n' "$version" > "$out/VERSION"
printf 'hdTrans v%s, Emscripten %s, -sDYNAMIC_EXECUTION=0 (scripts/build-engine.sh)\n' \
  "$version" "$emcc_version" > "$out/BUILD.txt"
if grep -q -E 'new Function|eval\(' "$out/hdtrans_engine.js"; then
  echo "build-engine: hdtrans_engine.js still generates code at run time" >&2
  exit 1
fi
echo "build-engine: hdTrans v$version → vendor/hdtrans/"
