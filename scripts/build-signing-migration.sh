#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Local-only Android 9+ bridge from the original test key to the existing
# production key. Ordinary releases must continue using build-apk.sh.
for required in ANDROID_HOME JAVA_HOME PEEL_KEYSTORE_PATH PEEL_KEYSTORE_PASSWORD PEEL_KEY_ALIAS PEEL_KEY_PASSWORD PEEL_SIGNING_CERT_SHA256 PEEL_LEGACY_KEYSTORE_PATH PEEL_LEGACY_KEYSTORE_PASSWORD PEEL_LEGACY_KEY_ALIAS PEEL_LEGACY_KEY_PASSWORD; do
  [[ -n "${!required:-}" ]] || { echo "Missing $required" >&2; exit 1; }
done
export PATH="$JAVA_HOME/bin:$PATH"
[[ "$PEEL_SIGNING_CERT_SHA256" == "73f6873772c4d869c4219d7b828221a43c6cb11213c8518f01d2c22b3525a2aa" ]] || { echo "Use the existing Peel production certificate" >&2; exit 1; }
for key in "$PEEL_KEYSTORE_PATH" "$PEEL_LEGACY_KEYSTORE_PATH"; do
  [[ "$key" = /* && -f "$key" ]] || { echo "Signing keystores must be existing absolute paths" >&2; exit 1; }
done
export CI=1 EXPO_NO_TELEMETRY=1
peel_migration_tmp="$(mktemp -d "${TMPDIR:-/tmp}/peel-migration.XXXXXX")"
trap 'rm -rf -- "$peel_migration_tmp"' EXIT
export TMPDIR="$peel_migration_tmp"
EXPO_OFFLINE=1 bunx expo install --check
node scripts/release-info.mjs --check
peel_version="$(node scripts/release-info.mjs --version)"
peel_migration_dir="artifacts/migration/$peel_version"
mkdir -p "$peel_migration_dir"
chmod 700 "$peel_migration_dir"
peel_signer="$ANDROID_HOME/build-tools/36.0.0/apksigner"

# The manifest really requires API 28. A v3-only APK must never claim support
# for API 24-27, whose package managers cannot read signing-key rotation.
bunx expo prebuild --platform android --no-install
./android/gradlew -p android :app:assembleRelease \
  -PpeelSigningMigration=true -PreactNativeArchitectures=arm64-v8a,x86_64 \
  -Dorg.gradle.java.installations.paths="$JAVA_HOME" \
  --max-workers=2 --no-daemon --console=plain

"$peel_signer" rotate --out "$peel_migration_dir/signing.lineage" \
  --old-signer --ks "$PEEL_LEGACY_KEYSTORE_PATH" \
  --ks-key-alias "$PEEL_LEGACY_KEY_ALIAS" \
  --ks-pass env:PEEL_LEGACY_KEYSTORE_PASSWORD --key-pass env:PEEL_LEGACY_KEY_PASSWORD \
  --set-installed-data true --set-rollback false \
  --new-signer --ks "$PEEL_KEYSTORE_PATH" --ks-key-alias "$PEEL_KEY_ALIAS" \
  --ks-pass env:PEEL_KEYSTORE_PASSWORD --key-pass env:PEEL_KEY_PASSWORD

"$peel_signer" sign --out "$peel_migration_dir/peel-$peel_version-signing-migration.apk" \
  --ks "$PEEL_KEYSTORE_PATH" --ks-key-alias "$PEEL_KEY_ALIAS" \
  --ks-pass env:PEEL_KEYSTORE_PASSWORD --key-pass env:PEEL_KEY_PASSWORD \
  --lineage "$peel_migration_dir/signing.lineage" --rotation-min-sdk-version 28 \
  --min-sdk-version 28 --v1-signing-enabled false --v2-signing-enabled false \
  --v3-signing-enabled true --v4-signing-enabled false \
  android/app/build/outputs/apk/release/app-release.apk
node scripts/verify-signing-migration.mjs "$peel_migration_dir/peel-$peel_version-signing-migration.apk" "$peel_migration_dir"

echo "Local migration only. Publish the ordinary production APK, never this APK."
