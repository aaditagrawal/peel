import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const [apk, outputDirectory] = process.argv.slice(2);
if (!apk || !outputDirectory)
  throw new Error("Usage: node scripts/verify-apk.mjs APK OUTPUT_DIRECTORY");
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error("ANDROID_HOME is required");
const tools = join(sdk, "build-tools", "36.0.0");
const certificate = execFileSync(
  join(tools, "apksigner"),
  ["verify", "--verbose", "--print-certs", apk],
  { encoding: "utf8" },
);
const digests = [
  ...certificate.matchAll(
    /^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)$/gim,
  ),
].map((m) => m[1].toLowerCase());
const expected = (process.env.PEEL_SIGNING_CERT_SHA256 || "")
  .replaceAll(":", "")
  .trim()
  .toLowerCase();
const productionCertificate =
  "73f6873772c4d869c4219d7b828221a43c6cb11213c8518f01d2c22b3525a2aa";
if (
  expected !== productionCertificate ||
  digests.length !== 1 ||
  digests[0] !== expected
) {
  throw new Error(
    "APK signing certificate does not match PEEL_SIGNING_CERT_SHA256",
  );
}
if (
  /Android Debug/i.test(certificate) ||
  expected ===
    "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c"
) {
  throw new Error("A debug signing certificate cannot be published");
}
const config = JSON.parse(readFileSync("app.json", "utf8")).expo;
const badging = execFileSync(join(tools, "aapt"), ["dump", "badging", apk], {
  encoding: "utf8",
});
const identity = badging.match(
  /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m,
);
if (
  !identity ||
  identity[1] !== config.android.package ||
  identity[2] !== String(config.android.versionCode) ||
  identity[3] !== config.version
) {
  throw new Error("Built APK identity or version does not match app.json");
}
if (/^application-debuggable/m.test(badging))
  throw new Error("Release APK must not be debuggable");
if (!/^sdkVersion:'24'$/m.test(badging))
  throw new Error("Ordinary releases must retain Android API 24 support");
const abis = badging.match(/^native-code: (.+)$/m)?.[1];
if (abis?.split(" ").sort().join(" ") !== "'arm64-v8a' 'x86_64'")
  throw new Error("APK must include both supported 64-bit architectures");
for (const api of [24, 27, 28, 32, 33, 37]) {
  const verified = execFileSync(
    join(tools, "apksigner"),
    [
      "verify",
      "--min-sdk-version",
      String(api),
      "--max-sdk-version",
      String(api),
      "--print-certs",
      apk,
    ],
    { encoding: "utf8" },
  );
  const current = [
    ...verified.matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)$/gim,
    ),
  ];
  if (
    current.length !== 1 ||
    current[0][1].toLowerCase() !== productionCertificate
  )
    throw new Error(
      `Production signer must remain unchanged on Android API ${api}`,
    );
}
const sha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
const metadata = {
  version: config.version,
  versionCode: config.android.versionCode,
  packageName: config.android.package,
  file: basename(apk),
  sha256,
  signingCertificateSha256: expected,
  architectures: ["arm64-v8a", "x86_64"],
};
writeFileSync(
  join(outputDirectory, "SHA256SUMS"),
  `${sha256}  ${basename(apk)}\n`,
);
writeFileSync(
  join(outputDirectory, "release.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
console.log(
  `Verified ${basename(apk)}: version ${config.version} (${config.android.versionCode}), release signer ${expected}`,
);
