import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const config = JSON.parse(readFileSync("app.json", "utf8")).expo;
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { version } = config;
const versionCode = config.android.versionCode;
const packageName = config.android.package;
function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}
requireValid(
  /^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version),
  "Use x.y.z or x.y.z-rc.N app versions",
);
requireValid(
  pkg.version === version,
  "package.json and app.json versions must match",
);
requireValid(
  Number.isSafeInteger(versionCode) &&
    versionCode > 0 &&
    versionCode <= 2100000000,
  "Invalid Android versionCode",
);
requireValid(
  packageName === "app.peel.stickers",
  "Do not change the installed app's package identity",
);
const tag = process.env.PEEL_RELEASE_TAG;
if (tag) {
  requireValid(
    tag === `v${version}`,
    "Release tag must match app.json version",
  );
  const tags = execFileSync("git", ["tag", "--list", "v*"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const previous of tags) {
    if (
      previous === tag ||
      !/^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(previous)
    )
      continue;
    const old = JSON.parse(
      execFileSync("git", ["show", `${previous}:app.json`], {
        encoding: "utf8",
      }),
    ).expo;
    requireValid(
      versionCode > old.android.versionCode,
      `versionCode must exceed ${previous}'s ${old.android.versionCode}`,
    );
    const parts = (value) => {
      const [core, rc] = value.split("-rc.");
      return [...core.split(".").map(Number), rc ? Number(rc) : Infinity];
    };
    const nowParts = parts(version);
    const oldParts = parts(previous.slice(1));
    const firstDifference = nowParts.findIndex(
      (part, i) => part !== oldParts[i],
    );
    requireValid(
      firstDifference >= 0 &&
        nowParts[firstDifference] > oldParts[firstDifference],
      `Version must be newer than ${previous}`,
    );
  }
}
const info = {
  version,
  versionCode,
  packageName,
  prerelease: version.includes("-rc."),
  apk: `peel-${version}.apk`,
  architectures: ["arm64-v8a", "x86_64"],
};
if (process.argv.includes("--version")) console.log(version);
else console.log(JSON.stringify(info, null, 2));
