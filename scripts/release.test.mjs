import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const script = resolve("scripts/release-info.mjs");
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "peel-release-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.invalid");
  const write = (version, code) => {
    writeFileSync(
      join(cwd, "app.json"),
      JSON.stringify({
        expo: {
          version,
          android: { versionCode: code, package: "app.peel.stickers" },
        },
      }),
    );
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ version }));
  };
  const tag = (version, code) => {
    write(version, code);
    git("add", ".");
    git("commit", "-qm", version);
    git("tag", `v${version}`);
  };
  const check = (tag) =>
    spawnSync(process.execPath, [script, "--check"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PEEL_RELEASE_TAG: tag },
    });
  return { write, tag, check };
}

test("stable release upgrades from a release candidate with a higher Android code", (t) => {
  const f = fixture(t);
  f.tag("1.0.8", 9);
  f.tag("1.1.0-rc.1", 10);
  f.write("1.1.0", 11);
  const result = f.check("v1.1.0");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).prerelease, false);
});

test("release candidate metadata is marked as prerelease", (t) => {
  const f = fixture(t);
  f.tag("1.0.8", 9);
  f.write("1.1.0-rc.1", 10);
  const result = f.check("v1.1.0-rc.1");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).prerelease, true);
});

test("rejects a reused version code and a mismatched tag", (t) => {
  const f = fixture(t);
  f.tag("1.0.8", 9);
  f.write("1.1.0", 9);
  assert.match(f.check("v1.1.0").stderr, /versionCode must exceed/);
  assert.match(f.check("v1.2.0").stderr, /tag must match/);
});

test("rejects an older semantic version even when Android versionCode is higher", (t) => {
  const f = fixture(t);
  f.tag("1.1.0", 11);
  f.write("1.0.9", 12);
  assert.match(f.check("v1.0.9").stderr, /Version must be newer/);
});

test("release signing survives repeated prebuild mods without embedding secrets", async () => {
  const require = createRequire(import.meta.url);
  const plugin = require("../plugins/with-release-signing.js");
  const config = plugin({ name: "Test", slug: "test" });
  const apply = async (contents) =>
    (
      await config.mods.android.appBuildGradle({
        modRequest: {},
        modResults: { language: "groovy", contents },
      })
    ).modResults.contents;
  const first = await apply(
    "android { buildTypes { release { signingConfig signingConfigs.debug } } }\n",
  );
  assert.equal(await apply(first), first);
  assert.match(
    first,
    /buildTypes.release.signingConfig = signingConfigs.peelRelease/,
  );
  assert.match(first, /throw new GradleException/);
  assert.match(first, /System.getenv\("PEEL_KEYSTORE_PASSWORD"\)/);
});
