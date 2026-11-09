import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateMigrationApk } from "./verify-signing-migration.mjs";

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const versions =
  sdk && existsSync(join(sdk, "build-tools"))
    ? readdirSync(join(sdk, "build-tools"))
        .filter((v) => /^(36|37)\.\d+\.\d+$/.test(v))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];

test(
  "migration validator verifies disposable proofs and rejects unsafe variants",
  {
    skip:
      !sdk || versions.length === 0
        ? "Requires ANDROID_HOME and SDK build-tools 36 or 37"
        : false,
  },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "peel-migration-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const tools = join(sdk, "build-tools", versions[0]);
    const run = (command, args) =>
      execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const keytool = process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, "bin", "keytool")
      : "keytool";
    const key = (name) => [
      "--ks",
      join(directory, `${name}.p12`),
      "--ks-key-alias",
      name,
      "--ks-pass",
      "pass:disposable-test-only",
    ];
    const certificates = {};
    for (const name of ["a", "b"]) {
      run(keytool, [
        "-genkeypair",
        "-noprompt",
        "-keystore",
        join(directory, `${name}.p12`),
        "-storetype",
        "PKCS12",
        "-storepass",
        "disposable-test-only",
        "-keypass",
        "disposable-test-only",
        "-alias",
        name,
        "-dname",
        `CN=Disposable migration test ${name}`,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "2",
      ]);
      certificates[name] = createHash("sha256")
        .update(
          run(keytool, [
            "-exportcert",
            "-keystore",
            join(directory, `${name}.p12`),
            "-storepass",
            "disposable-test-only",
            "-alias",
            name,
          ]),
        )
        .digest("hex");
    }
    for (const capability of ["true", "false"]) {
      run(join(tools, "apksigner"), [
        "rotate",
        "--out",
        join(directory, `${capability}.lineage`),
        "--old-signer",
        ...key("a"),
        "--set-installed-data",
        capability,
        "--new-signer",
        ...key("b"),
      ]);
    }
    const platforms = readdirSync(join(sdk, "platforms")).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    const android = platforms
      .map((v) => join(sdk, "platforms", v, "android.jar"))
      .find(existsSync);
    assert.ok(android, "Requires an installed Android SDK platform");
    for (const min of [24, 28]) {
      const manifest = join(directory, `manifest${min}.xml`);
      writeFileSync(
        manifest,
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.peel.migrationfixture" android:versionCode="2" android:versionName="2"><uses-sdk android:minSdkVersion="${min}" android:targetSdkVersion="35"/><application android:hasCode="false"/></manifest>`,
      );
      run(join(tools, "aapt2"), [
        "link",
        "-I",
        android,
        "--manifest",
        manifest,
        "-o",
        join(directory, `unsigned${min}.apk`),
      ]);
    }
    const sign = (
      name,
      {
        min = 28,
        capability = "true",
        v1 = false,
        v2 = false,
        lineage = true,
      } = {},
    ) => {
      run(join(tools, "apksigner"), [
        "sign",
        "--min-sdk-version",
        "28",
        "--v1-signing-enabled",
        String(v1),
        "--v2-signing-enabled",
        String(v2),
        "--v3-signing-enabled",
        "true",
        "--v4-signing-enabled",
        "false",
        ...(v1 || v2 ? [...key("a"), "--next-signer"] : []),
        ...key("b"),
        ...(lineage
          ? [
              "--rotation-min-sdk-version",
              "28",
              "--lineage",
              join(directory, `${capability}.lineage`),
            ]
          : []),
        "--out",
        join(directory, `${name}.apk`),
        join(directory, `unsigned${min}.apk`),
      ]);
    };
    sign("valid");
    sign("old-minimum", { min: 24 });
    sign("v1", { v1: true });
    sign("v2", { v2: true });
    sign("no-data", { capability: "false" });
    sign("no-proof", { lineage: false });
    const expected = { legacy: certificates.a, production: certificates.b };
    const config = {
      version: "2",
      android: { package: "dev.peel.migrationfixture", versionCode: 2 },
    };
    const verify = (name, trusted = expected, app = config) =>
      validateMigrationApk(join(directory, `${name}.apk`), trusted, app);
    await t.test(
      "current B and authorized A-to-B proof verify exactly at API 28 and 37",
      () => {
        const result = verify("valid");
        assert.match(result.proof, /API 28:/);
        assert.match(result.proof, /API 37:/);
        assert.match(result.sha256, /^[a-f0-9]{64}$/);
      },
    );
    for (const [name, message] of [
      ["old-minimum", /minSdkVersion must be exactly 28/],
      ["v1", /must not contain v1 signatures/],
      ["v2", /must not contain a v2 signing block/],
      ["no-data", /lacks the INSTALLED_DATA/],
      ["no-proof", /no verified rotation proof/],
    ]) {
      await t.test(`rejects ${name}`, () =>
        assert.throws(() => verify(name), message),
      );
    }
    await t.test("rejects a different current certificate", () =>
      assert.throws(
        () => verify("valid", { ...expected, production: certificates.a }),
        /not the production certificate/,
      ),
    );
    await t.test("rejects a different ancestor", () =>
      assert.throws(
        () => verify("valid", { ...expected, legacy: certificates.b }),
        /exactly legacy A followed/,
      ),
    );
    await t.test("rejects mismatched app version", () =>
      assert.throws(
        () => verify("valid", expected, { ...config, version: "3" }),
        /identity or version/,
      ),
    );
  },
);
