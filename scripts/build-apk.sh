#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Matches .github/workflows/release.yml. Bun's frozen lockfile and Expo's generated
# Gradle wrapper select dependency versions; never use an unpinned global Expo CLI.
[[ "$(bun --version)" == "1.4.3" ]] || { echo "Bun 1.4.3 is required" >&2; exit 1; }
[[ "$(node --version)" == "v24.21.0" ]] || { echo "Node 24.21.0 is required" >&2; exit 1; }
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-}}"
export ANDROID_HOME
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
command -v ffmpeg >/dev/null || { echo "FFmpeg is required for converter tests" >&2; exit 1; }
"$JAVA_HOME/bin/javac" -version 2>&1 | grep -Eq '^javac 21\.' || { echo "JDK 21 is required" >&2; exit 1; }
for required in PEEL_KEYSTORE_PATH PEEL_KEYSTORE_PASSWORD PEEL_KEY_ALIAS PEEL_KEY_PASSWORD PEEL_SIGNING_CERT_SHA256; do
  [[ -n "${!required:-}" ]] || { echo "Missing $required" >&2; exit 1; }
done
[[ "$PEEL_KEYSTORE_PATH" = /* && -f "$PEEL_KEYSTORE_PATH" ]] || { echo "PEEL_KEYSTORE_PATH must be an existing absolute path" >&2; exit 1; }
for component in 'platforms/android-36' 'build-tools/36.0.0' 'ndk/27.1.12297006' 'cmake/3.22.1'; do
  [[ -d "$ANDROID_HOME/$component" ]] || { echo "Missing Android SDK component $component" >&2; exit 1; }
done
export CI=1
export EXPO_NO_TELEMETRY=1
unset PEEL_LOCAL_CONVERTER
bun install --frozen-lockfile
node scripts/release-info.mjs --check
node --test scripts/release.test.mjs
bun run lint
bun run typecheck
bun run test
bunx expo prebuild --platform android --no-install
grep -q '// Peel release signing' android/app/build.gradle || { echo "Register with-release-signing in app.json before building a release" >&2; exit 1; }
./android/gradlew -p android :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,x86_64 \
  -Dorg.gradle.java.installations.paths="$JAVA_HOME" --no-daemon --console=plain
peel_version="$(node scripts/release-info.mjs --version)"
mkdir -p artifacts/release
cp android/app/build/outputs/apk/release/app-release.apk "artifacts/release/peel-$peel_version.apk"
node scripts/verify-apk.mjs "artifacts/release/peel-$peel_version.apk" artifacts/release
