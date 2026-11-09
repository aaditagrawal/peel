import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const legacyCertificate =
  "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";
const productionCertificate =
  "73f6873772c4d869c4219d7b828221a43c6cb11213c8518f01d2c22b3525a2aa";

const proofVerifier = String.raw`
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.zip.ZipFile;

class MigrationProof {
  static void require(boolean condition, String message) {
    if (!condition) throw new IllegalStateException(message);
  }
  static String digest(X509Certificate certificate) throws Exception {
    byte[] bytes = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
    StringBuilder value = new StringBuilder();
    for (byte b : bytes) value.append(String.format("%02x", b));
    return value.toString();
  }
  public static void main(String[] args) throws Exception {
    try (ZipFile zip = new ZipFile(args[0])) {
      require(zip.stream().noneMatch(entry -> entry.getName().toUpperCase(java.util.Locale.ROOT)
          .matches("META-INF/[^/]+\\.(SF|RSA|DSA|EC)")), "Migration APK must not contain v1 signatures");
    }
    for (int sdk : new int[] {28, 37}) {
      var result = new ApkVerifier.Builder(new File(args[0]))
        .setMinCheckedPlatformVersion(sdk).setMaxCheckedPlatformVersion(sdk).build().verify();
      require(result.isVerified(), "APK verification failed at API " + sdk + ": " + result.getErrors());
      require(result.isVerifiedUsingV3Scheme(), "Migration APK must verify using v3 at API " + sdk);
      require(!result.isVerifiedUsingV1Scheme() && !result.isVerifiedUsingV2Scheme(), "Unexpected legacy signature scheme");
      require(result.getSignerCertificates().size() == 1, "Migration APK must have one current signer");
      var current = result.getSignerCertificates().get(0);
      require(digest(current).equals(args[2]), "Migration APK current signer is not the production certificate");
      var active = result.getV3SchemeSigners().stream().filter(signer ->
        !signer.containsErrors() && sdk >= signer.getMinSdkVersion() && sdk <= signer.getMaxSdkVersion()
          && signer.getCertificate().equals(current)).toList();
      require(active.size() == 1, "Expected one active v3 signer at API " + sdk);
      var lineage = active.get(0).getSigningCertificateLineage();
      require(lineage != null, "Migration APK has no verified rotation proof");
      var certificates = lineage.getCertificatesInLineage();
      require(certificates.size() == 2 && digest(certificates.get(0)).equals(args[1])
        && digest(certificates.get(1)).equals(args[2]), "Migration proof must contain exactly legacy A followed by production B");
      require(lineage.getSignerCapabilities(certificates.get(0)).hasInstalledData(),
        "Legacy certificate lacks the INSTALLED_DATA capability");
      System.out.println("API " + sdk + ": verified v3 production signer and authorized A-to-B rotation");
    }
  }
}
`;

function signingBlockIds(bytes) {
  // Locate the EOCD using its comment length, rather than matching magic inside ZIP data.
  let eocd = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("APK has no valid ZIP end record");
  const central = bytes.readUInt32LE(eocd + 16);
  if (
    central < 24 ||
    central > eocd ||
    bytes.subarray(central - 16, central).toString() !== "APK Sig Block 42"
  )
    throw new Error("APK has no signing block");
  const blockSize = bytes.readBigUInt64LE(central - 24);
  if (blockSize < 24n || blockSize > BigInt(central - 8))
    throw new Error("APK signing block has an invalid size");
  const start = central - Number(blockSize) - 8;
  if (bytes.readBigUInt64LE(start) !== blockSize)
    throw new Error("APK signing block sizes do not match");
  const ids = new Set();
  let offset = start + 8;
  while (offset < central - 24) {
    if (offset + 8 > central - 24)
      throw new Error("Truncated APK signing block");
    const size = bytes.readBigUInt64LE(offset);
    if (size < 4n || size > BigInt(central - 24 - offset - 8))
      throw new Error("Invalid APK signing block entry");
    ids.add(bytes.readUInt32LE(offset + 8));
    offset += Number(size) + 8;
  }
  return ids;
}

// Tests can supply disposable public certificates without weakening the CLI's fixed trust anchors.
export function validateMigrationApk(apk, expected, config) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOME is required");
  const version = readdirSync(join(sdk, "build-tools"))
    .filter((name) => /^(36|37)\.\d+\.\d+$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .find((name) =>
      existsSync(join(sdk, "build-tools", name, "lib", "apksigner.jar")),
    );
  if (!version)
    throw new Error("Android SDK build-tools 36 or 37 are required");
  const tools = join(sdk, "build-tools", version);
  const badging = execFileSync(join(tools, "aapt2"), ["dump", "badging", apk], {
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
  )
    throw new Error(
      "Migration APK identity or version does not match app.json",
    );
  if (!/^minSdkVersion:'28'$/m.test(badging))
    throw new Error("Migration APK manifest minSdkVersion must be exactly 28");
  if (/^application-debuggable/m.test(badging))
    throw new Error("Migration APK must not be debuggable");
  const bytes = readFileSync(apk);
  const ids = signingBlockIds(bytes);
  if (ids.has(0x7109871a))
    throw new Error("Migration APK must not contain a v2 signing block");
  if (!ids.has(0xf05368c0))
    throw new Error("Migration APK must contain a v3 signing block");
  const temporary = mkdtempSync(join(tmpdir(), "peel-migration-proof-"));
  try {
    const source = join(temporary, "MigrationProof.java");
    writeFileSync(source, proofVerifier);
    const java = process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, "bin", "java")
      : "java";
    const proof = execFileSync(
      java,
      [
        "-cp",
        join(tools, "lib", "apksigner.jar"),
        source,
        resolve(apk),
        expected.legacy,
        expected.production,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      proof: proof.trim(),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [apk, outputDirectory] = process.argv.slice(2);
  if (!apk || !outputDirectory)
    throw new Error(
      "Usage: node scripts/verify-signing-migration.mjs APK OUTPUT_DIRECTORY",
    );
  const expected = (process.env.PEEL_SIGNING_CERT_SHA256 || "")
    .replaceAll(":", "")
    .trim()
    .toLowerCase();
  if (expected !== productionCertificate)
    throw new Error(
      "PEEL_SIGNING_CERT_SHA256 must match the fixed production B certificate",
    );
  const config = JSON.parse(readFileSync("app.json", "utf8")).expo;
  const result = validateMigrationApk(
    apk,
    {
      legacy: legacyCertificate,
      production: productionCertificate,
    },
    config,
  );
  const metadata = {
    purpose: "local-only-signing-migration",
    version: config.version,
    versionCode: config.android.versionCode,
    packageName: config.android.package,
    minSdkVersion: 28,
    file: basename(apk),
    sha256: result.sha256,
    signingCertificateSha256: productionCertificate,
    rotationAncestorSha256: legacyCertificate,
    installedData: true,
  };
  writeFileSync(
    join(outputDirectory, "SHA256SUMS"),
    `${result.sha256}  ${basename(apk)}\n`,
  );
  writeFileSync(
    join(outputDirectory, "migration.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  console.log(
    `${result.proof}\nVerified local migration ${basename(apk)}: ${config.version} (${config.android.versionCode})`,
  );
}
