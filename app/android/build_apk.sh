#!/usr/bin/env bash
# Build the Android APK without Gradle: aapt2 → javac → d8 → zipalign → apksigner.
# Needs: JDK 17+, Android SDK with platforms;android-34 and build-tools;34.0.0
#   ./build_apk.sh
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-2.0}"
OUT="../PaperTrader.apk"

rm -rf build && mkdir -p build/gen build/classes build/assets build/dex
cp -r ../web build/assets/www

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml \
  -A build/assets --java build/gen build/res.zip \
  --min-sdk-version 21 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"

javac -nowarn -source 8 -target 8 -bootclasspath "$JAR" -classpath "$JAR" -d build/classes \
  $(find build/gen src -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
"$BT/d8" --lib "$JAR" --min-api 21 --release --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../unsigned.apk classes.dex)

"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk

KS="${KEYSTORE:-keystore/release.jks}"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -alias app -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "${KS_PASS:-android}" -keypass "${KS_PASS:-android}" -dname "CN=Markets and Algos" >/dev/null 2>&1
  echo "Created signing key $KS – keep it; updates must be signed with the same key."
fi
"$BT/apksigner" sign --v4-signing-enabled false --ks "$KS" --ks-pass "pass:${KS_PASS:-android}" --out "$OUT" build/aligned.apk
"$BT/apksigner" verify "$OUT" && echo "APK: $(cd .. && pwd)/PaperTrader.apk ($(du -h "$OUT" | cut -f1))"
