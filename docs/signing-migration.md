# Local signing migration

This procedure moves an early `app.peel.stickers` installation from its original development key A to the existing production key B on Android 9 or newer, API 28 and above. Keep the package ID and installed app throughout. Both original private keys are required. Android 7 and 8 do not support this rotation.

The affected phone runs Android 17, API 37, with Peel 1.0.6, versionCode 7, signed by A. The private feed already has Peel 1.1.0, versionCode 13, signed by B. The replacement production build is 1.1.1, versionCode 14. These are the public certificate fingerprints:

| Key                  | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| A, early development | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| B, production        | `73f6873772c4d869c4219d7b828221a43c6cb11213c8518f01d2c22b3525a2aa` |

## Prepare the artifacts

Set `ANDROID_HOME` and `JAVA_HOME` as described in the README. Load signing credentials from private storage into the environment. Production uses `PEEL_KEYSTORE_PATH`, `PEEL_KEYSTORE_PASSWORD`, `PEEL_KEY_ALIAS`, `PEEL_KEY_PASSWORD`, and `PEEL_SIGNING_CERT_SHA256`. Migration additionally requires `PEEL_LEGACY_KEYSTORE_PATH`, `PEEL_LEGACY_KEYSTORE_PASSWORD`, `PEEL_LEGACY_KEY_ALIAS`, and `PEEL_LEGACY_KEY_PASSWORD`. Never put passwords in commands, source files, or build logs.

Build the normal production APK with `bun run build:apk`, with B as the expected signing fingerprint. It must have minSdk24 and contain arm64-v8a and x86_64. Keep its verified copy at `artifacts/release/peel-1.1.1.apk`. Then run `bash scripts/build-signing-migration.sh`. This builds a separate APK with manifest minSdk28 and writes `artifacts/migration/1.1.1/peel-1.1.1-signing-migration.apk` and `signing.lineage` in that directory.

This release pins Expo 57's supported Reanimated 4.5.1 and Worklets 0.10.1. Both build scripts use a fresh temporary Metro cache. After replacing native dependencies in an existing checkout, clear their generated CMake intermediates and those of modules that link them before rebuilding. In this checkout, that included Expo Modules Core and Gesture Handler. A release startup test caught mixed Worklets transformation formats in the first candidate; that candidate must not be installed or published.

| Artifact                         | Signing                                          | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Normal production 1.1.1, code 14 | B, normal signing schemes, minSdk24              | Existing stable private feed and future updates                                |
| Backup bridge 1.1.1, code 14     | A                                                | Local update that adds backup export before rotation                           |
| Migration 1.1.1, code 14         | B with A-to-B proof of rotation, v3 only, API28+ | Local update that changes the installed signing identity while preserving data |

Create the bridge by signing the new, unpublished code14 payload with A. Leave the published code13 artifact and its release history intact. Keep the bridge and migration APKs outside the normal release artifact directory and private feed. Publish only the normal B-signed production APK when private-feed publication is authorized.

The migration must disable v1 and v2 signing, use rotation minimum API28, and grant A the installed-data capability in the A-to-B lineage. Keep rollback disabled. A standard rotation APK that signs its v2 block with A would fail to update existing B installations on API24 through API27, so it must not replace the normal production artifact. See the [Android signing options](https://developer.android.com/tools/apksigner) and [AOSP lineage capability documentation](https://android.googlesource.com/platform/tools/apksig/+/master/src/apksigner/java/com/android/apksigner/help_rotate.txt).

## Update the phone without uninstalling

Select the intended device explicitly with `adb -s`. Confirm its API level, installed package, versionCode, signer, UID, and first-install time before proceeding. Record the current library contents without including private sticker images in shared logs.

1. Install the verified A-signed backup bridge with `adb -s "$PEEL_DEVICE_SERIAL" install -r "$PEEL_BRIDGE_APK"`. This replaces code7 with code14 using the same key.
2. Open Peel and confirm the existing packs and stickers load. In Settings, export a backup to a folder outside Peel. Confirm the exported JSON exists, parses, and contains the expected packs and sticker data. Keep a private independent copy before rotating keys.
3. Install the verified B-signed migration APK with `adb -s "$PEEL_DEVICE_SERIAL" install -r "$PEEL_MIGRATION_APK"`. Replacing code14 with another code14 is intentional. Use neither uninstall nor data clearing.
4. Confirm the installed signer is B and UID and first-install time are unchanged. Open the existing library and inspect packs and stickers. Test WhatsApp import if WhatsApp is available.
5. Install the normal B-signed production APK with `adb -s "$PEEL_DEVICE_SERIAL" install -r "$PEEL_PRODUCTION_APK"`. Confirm the same identity and library checks again. This proves the migrated installation accepts the ordinary production artifact.

Stop if an installation or data check fails. Keep the installed app and independent backup. Do not use a different package name, downgrade override, uninstall, or data clearing to force the transition.

## Verify and retain the release record

Verify the normal APK's package, version, minSdk24, non-debuggable status, exact ABI set, checksum, and B signer. Check its signature at API24, API27, API28, API32, API33, and API37.

The migration script invokes `scripts/verify-signing-migration.mjs` separately. Require manifest minSdk28 and verify its signature for API28 and the phone's API37. Inspect the embedded lineage with `apksigner lineage --in "$PEEL_MIGRATION_APK" --print-certs`; require exactly A followed by B and A's installed-data permission. Confirm the bridge has the same payload as its input APK apart from signatures. Review differences between normal and migration builds, including the intentional manifest minSdk change.

Retain checksums, certificate fingerprints, lineage capabilities, tool versions, source revision, APK metadata, and the successful device checks. Keep private keys and backup contents out of this record.

Future releases use the normal B signing key, an increasing versionCode, and a newer app version. Build and verify them through the ordinary production path. The migrated phone needs no migration APK, signing override, or reinstall procedure for these updates. Keep the normal private-feed configuration. All work for this task stays local or on the authorized private feed, with no upstream publication.
