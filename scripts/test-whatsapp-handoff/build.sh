#!/usr/bin/env bash
set -euo pipefail
# Standalone test fixture. This directory is not a Gradle dependency of Peel.
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sdk=${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK}
jdk=${JAVA_HOME:?Set JAVA_HOME to a JDK with javac}
build_tools="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
out="$root/build"
mkdir -p "$out/classes" "$out/dex"
"$jdk/bin/javac" --release 8 -classpath "$platform" -d "$out/classes" "$root"/src/peel/handoff/*.java
"$jdk/bin/jar" cf "$out/classes.jar" -C "$out/classes" .
JAVA_HOME="$jdk" "$build_tools/d8" --min-api 26 --lib "$platform" --output "$out/dex" "$out/classes.jar"
"$build_tools/aapt" package -f -M "$root/AndroidManifest.xml" -I "$platform" -F "$out/unsigned.apk"
(cd "$out/dex" && "$build_tools/aapt" add "$out/unsigned.apk" classes.dex)
"$build_tools/zipalign" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
if [[ ! -f "$out/fixture.keystore" ]]; then
  "$jdk/bin/keytool" -genkeypair -keystore "$out/fixture.keystore" -storepass android -keypass android -alias fixture -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Peel emulator test fixture' >/dev/null 2>&1
fi
JAVA_HOME="$jdk" "$build_tools/apksigner" sign --ks "$out/fixture.keystore" --ks-key-alias fixture --ks-pass pass:android --key-pass pass:android --out "$out/whatsapp-contract-test.apk" "$out/aligned.apk"
JAVA_HOME="$jdk" "$build_tools/apksigner" verify "$out/whatsapp-contract-test.apk"
printf '%s\n' "$out/whatsapp-contract-test.apk"
