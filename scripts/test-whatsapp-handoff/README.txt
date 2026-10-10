Peel WhatsApp handoff contract test

This is an emulator-only test double with package name com.whatsapp. It contains
no WhatsApp code and does not establish that the real WhatsApp app accepted a
pack. It checks the published handoff contract across an actual Android process
boundary. Nothing in this directory is included in the Peel release build.

Install only on a disposable emulator without WhatsApp. Never install it on the
user's phone. It uses a separate fixture signing key. No account/network access
or WhatsApp installation is needed.

Build:
  JAVA_HOME=/path/to/jdk21 ANDROID_HOME=/path/to/sdk ./build.sh

Install after the Peel APK on the emulator:
  adb -s emulator-5580 install build/whatsapp-contract-test.apk

Select the result to return, then tap Import to WhatsApp inside Peel:
  adb -s emulator-5580 shell am broadcast -n com.whatsapp/peel.handoff.ModeReceiver --es mode accept
  adb -s emulator-5580 shell am broadcast -n com.whatsapp/peel.handoff.ModeReceiver --es mode reject
  adb -s emulator-5580 shell am broadcast -n com.whatsapp/peel.handoff.ModeReceiver --es mode cancel

All three modes validate the caller, provider and files. Accept returns RESULT_OK
only after validation passes. Reject sends RESULT_CANCELED with validation_error.
Cancel sends RESULT_CANCELED without validation_error, matching a user backing out.
The latest JSON report is available from the fixture's private files:
  adb -s emulator-5580 shell run-as com.whatsapp cat files/latest.json
  adb -s emulator-5580 logcat -d -s PeelHandoffContract:I '*:S'

The report must have contractPassed=true and callingPackage=app.peel.stickers.
Check Peel's UI separately: successful import finishes, rejection displays its
validation message, and cancellation does not display a false success or error.
The fixture defines com.whatsapp.sticker.READ as a signature permission under its
own signing key, so its provider reads also exercise Android permission checks.

For the prior implementation, opening the receiver from context.startActivity
with FLAG_ACTIVITY_NEW_TASK yields a null callingPackage. Its report will contain
contractPassed=false and "Caller identity missing". A launch from adb directly
also intentionally fails this check.
