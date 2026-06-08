#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

APP_NAME="Mac Fan Profile.app"
EXECUTABLE_NAME="Mac Fan Profile"
SCRIPT_NAME="fan-profile.sh"
SOURCE_NAME="MacFanProfileApp.swift"

rm -rf "$APP_NAME"
mkdir -p "$APP_NAME/Contents/MacOS" "$APP_NAME/Contents/Resources"

swiftc \
  -parse-as-library \
  -framework SwiftUI \
  -framework AppKit \
  "$SOURCE_NAME" \
  -o "$APP_NAME/Contents/MacOS/$EXECUTABLE_NAME"

cat > "$APP_NAME/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Mac Fan Profile</string>
  <key>CFBundleIdentifier</key>
  <string>local.mac-fan-profile</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Mac Fan Profile</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.1</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP_NAME/Contents/PkgInfo"
mkdir -p "$APP_NAME/Contents/Resources"
cp "$SCRIPT_NAME" "$APP_NAME/Contents/Resources/$SCRIPT_NAME"
chmod +x "$APP_NAME/Contents/Resources/$SCRIPT_NAME"
codesign --force --deep --sign - "$APP_NAME" >/dev/null

# The app is built locally, but clear quarantine if a copied resource carries it.
xattr -dr com.apple.quarantine "$APP_NAME" 2>/dev/null || true

printf 'Built %s/%s\n' "$PWD" "$APP_NAME"
