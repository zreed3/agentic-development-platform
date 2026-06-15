#!/usr/bin/env bash
# Cross-compile adg-asset-lint for every distributed platform into ./dist/.
#
# Requires (one-time):
#   rustup
#   zig                 (brew install zig)            -- the universal cross-linker
#   cargo-zigbuild      (cargo install --locked cargo-zigbuild)
#
# The crate is pure Rust (no C dependencies), so every target links cleanly. macOS
# targets build natively on a macOS host; the Linux/Windows targets cross-build through
# zig. Linux targets are static musl, so they run on any Linux without a libc dependency.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist

native=(aarch64-apple-darwin x86_64-apple-darwin)
cross=(x86_64-unknown-linux-musl aarch64-unknown-linux-musl x86_64-pc-windows-gnu aarch64-pc-windows-gnullvm)

for t in "${native[@]}" "${cross[@]}"; do rustup target add "$t" >/dev/null 2>&1 || true; done
if [[ "$(uname -s)" == "Darwin" ]]; then
  for t in "${native[@]}"; do echo "building $t (native)"; cargo build --release --target "$t"; done
else
  for t in "${native[@]}"; do echo "building $t (zig)"; cargo zigbuild --release --target "$t"; done
fi
for t in "${cross[@]}"; do echo "building $t (zig)"; cargo zigbuild --release --target "$t"; done

copy() { cp "target/$1/release/$2" "dist/$3"; echo "  dist/$3"; }
echo "gathering:"
copy aarch64-apple-darwin        adg-asset-lint     adg-asset-lint-macos-arm64
copy x86_64-apple-darwin         adg-asset-lint     adg-asset-lint-macos-x64
copy x86_64-unknown-linux-musl   adg-asset-lint     adg-asset-lint-linux-x64
copy aarch64-unknown-linux-musl  adg-asset-lint     adg-asset-lint-linux-arm64
copy x86_64-pc-windows-gnu       adg-asset-lint.exe adg-asset-lint-windows-x64.exe
copy aarch64-pc-windows-gnullvm  adg-asset-lint.exe adg-asset-lint-windows-arm64.exe

( cd dist && shasum -a 256 adg-asset-lint-* > SHA256SUMS && echo "wrote dist/SHA256SUMS" )
