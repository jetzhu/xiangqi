#!/usr/bin/env bash
# Build Pikafish (official source) to WebAssembly for Node benchmarking, and fetch both
# engines' networks. Outputs go to vendor/ (git-ignored).
#
# Needs: git, curl, Emscripten 3.1.74 (emsdk at ~/.local/emsdk or EMSDK set).
set -euo pipefail

PIKAFISH_COMMIT=1c66b9b21cf2f280ce3b3ffa80c1c6609f2b29ff   # 2026-10-01
FAIRY_NET=xiangqi-c07e94a5c7cb.nnue                          # sha256 starts with c07e94a5c7cb

here="$(cd "$(dirname "$0")" && pwd)"
vendor="$here/vendor"
mkdir -p "$vendor/pikafish" "$vendor/fairy"
# The spike package is ESM; the Emscripten glue is CommonJS.
echo '{"type":"commonjs"}' > "$vendor/package.json"

# shellcheck disable=SC1091
source "${EMSDK:-$HOME/.local/emsdk}/emsdk_env.sh" >/dev/null

src="$vendor/Pikafish-src"
[ -d "$src" ] || git clone -q https://github.com/official-pikafish/Pikafish.git "$src"
git -C "$src" fetch -q origin
git -C "$src" checkout -q "$PIKAFISH_COMMIT"

# Workarounds for building the upstream wasm32 target with Emscripten:
#  - the Makefile passes -m64 to every clang build, which Emscripten reads as wasm64: strip it;
#  - `em++ -dumpversion` reports Emscripten's version, so the clang<16 check misfires: override;
#  - RTLIB=compiler-rt skips -latomic, which Emscripten does not ship (atomics are built in).
stub="$src/wasm-stub"
mkdir -p "$stub"
cat > "$stub/em++-wrap" <<'EOF'
#!/bin/bash
args=()
for a in "$@"; do [[ "$a" == "-m64" ]] || args+=("$a"); done
exec em++ "${args[@]}"
EOF
chmod +x "$stub/em++-wrap"

make -C "$src/src" clean >/dev/null
make -C "$src/src" -j"$(nproc)" build ARCH=wasm32 COMP=clang CXX="$stub/em++-wrap" \
  clangmajorversion=19 RTLIB=compiler-rt \
  EXTRALDFLAGS="-sNODERAWFS=1 -sPTHREAD_POOL_SIZE=8"
cp "$src/src/pikafish.js" "$src/src/pikafish.wasm" "$vendor/pikafish/"

# Networks. Pikafish's net is a rolling release asset; record its hash with results.
[ -f "$vendor/pikafish/pikafish.nnue" ] || curl -sSL -o "$vendor/pikafish/pikafish.nnue" \
  https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue
[ -f "$vendor/fairy/$FAIRY_NET" ] || curl -sSL -o "$vendor/fairy/$FAIRY_NET" \
  "https://drive.usercontent.google.com/download?id=18-zDt7z4H9_IQVvcWIvndnKjC5LZhAfm&export=download&confirm=t"
sha256sum "$vendor/pikafish/pikafish.nnue" "$vendor/fairy/$FAIRY_NET"
echo "Done. Run: node bench.mjs all"
