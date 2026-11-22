#!/usr/bin/env bash
# 组一个未签名 IPA：swiftc 直接编 arm64 可执行文件，手工拼 .app 包，不依赖 Xcode 工程
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="WristNote"
OUT="build/Payload/${APP_NAME}.app"

rm -rf build "${APP_NAME}.ipa"
mkdir -p "$OUT"

SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
echo "SDK: $SDK"

SRC_FILES=$(find ios/WristNote -maxdepth 1 -name '*.swift' | sort)
echo "sources:"
echo "$SRC_FILES"

# shellcheck disable=SC2086
xcrun --sdk iphoneos swiftc \
  -target arm64-apple-ios15.0 \
  -sdk "$SDK" \
  -O -whole-module-optimization \
  -module-name "$APP_NAME" \
  -Xlinker -dead_strip \
  $SRC_FILES \
  -o "$OUT/$APP_NAME"

cp ios/WristNote/Info.plist "$OUT/Info.plist"
cp -R ios/WristNote/www "$OUT/www"

plutil -lint "$OUT/Info.plist"
xcrun lipo -info "$OUT/$APP_NAME"

# ad-hoc 签名让包结构合法；最终由签名工具重新签名
codesign --force --sign - --timestamp=none "$OUT" 2>/dev/null || true

cd build
zip -qry "../${APP_NAME}.ipa" Payload
cd ..
ls -l "${APP_NAME}.ipa"
echo "DONE: ${APP_NAME}.ipa"
