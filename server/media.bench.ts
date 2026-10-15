// Run: node --import tsx server/media.bench.ts baseline|tuned
// Optional PEEL_CONVERTER_DIR points to a saved baseline implementation.
import sharp from "sharp";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { imageFixtures } from "./media-fixtures";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

async function visibleMetrics(input: Buffer, output: Buffer) {
  const reference = await sharp(input, { page: 0 })
    .autoOrient()
    .resize(512, 512, { fit: "contain", background: "#00000000" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const actual = await sharp(output, { page: 0 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  let squared = 0;
  let alpha = 0;
  for (let i = 0; i < actual.length; i += 4) {
    alpha += Math.abs(reference[i + 3] - actual[i + 3]);
    for (let c = 0; c < 3; c++)
      squared +=
        ((reference[i + c] * reference[i + 3] - actual[i + c] * actual[i + 3]) /
          255) **
        2;
  }
  const mse = squared / ((actual.length / 4) * 3);
  return {
    alphaMeanError: +(alpha / (actual.length / 4)).toFixed(3),
    premultipliedPsnr:
      mse === 0 ? "lossless" : +(10 * Math.log10(255 ** 2 / mse)).toFixed(2),
  };
}

async function videoBench(dir: string, label: string) {
  const exec = promisify(execFile);
  const { convertVideo } = await import(
    pathToFileURL(
      join(process.env.PEEL_CONVERTER_DIR || resolve("server"), "video.ts"),
    ).href
  );
  const measurements = [];
  for (const [name, filter, duration] of [
    ["simple-video", "testsrc2=size=320x180:rate=15", 1],
    [
      "detailed-video",
      "color=c=gray:s=512x256:r=15,noise=alls=100:allf=t+u:all_seed=17",
      3,
    ],
  ] as const) {
    const source = join(dir, `${name}-source.mp4`);
    // Reuse the exact encoded input across baseline/tuned runs, independent of
    // codec threading or source-generator differences on another machine.
    const input = await readFile(source).catch(async () => {
      await exec("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-filter_threads",
        "1",
        "-f",
        "lavfi",
        "-i",
        filter,
        "-t",
        String(duration),
        "-c:v",
        "libx264",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "2",
        source,
      ]);
      return readFile(source);
    });
    const start = performance.now();
    const result = await convertVideo(input, 0, duration);
    const ms = performance.now() - start;
    const output = Buffer.from(result.data, "base64");
    await writeFile(join(dir, `${name}-${label}.webp`), output);
    const meta = await sharp(output, { animated: true }).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.pageHeight || meta.height, 512);
    assert.ok(result.bytes <= (result.animated ? 500 : 100) * 1024);
    assert.ok(
      Math.abs(
        (meta.delay?.reduce((sum, n) => sum + n, 0) || 0) - duration * 1000,
      ) <= 70,
    );
    await sharp(output, { page: 0 })
      .png()
      .toFile(join(dir, `${name}-${label}-frame.png`));
    const sourceFrame = join(dir, `${name}-source-frame.png`);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-vf",
      "fps=15,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      "-frames:v",
      "1",
      sourceFrame,
    ]);
    measurements.push({
      name,
      ms: +ms.toFixed(1),
      bytes: result.bytes,
      quality: result.quality,
      frames: meta.pages || 1,
      durationMs: meta.delay?.reduce((sum, n) => sum + n, 0) || 0,
      ...(await visibleMetrics(await readFile(sourceFrame), output)),
    });
    console.log(measurements.at(-1));
  }
  await writeFile(
    join(dir, `${label}-video.json`),
    JSON.stringify(measurements, null, 2),
  );
}

async function main() {
  const label = process.argv[2] || "tuned";
  const dir = resolve("artifacts/quality-web");
  await mkdir(dir, { recursive: true });
  if (process.argv.includes("--video-only")) return videoBench(dir, label);
  const { convertSticker } = await import(
    pathToFileURL(
      join(process.env.PEEL_CONVERTER_DIR || resolve("server"), "convert.ts"),
    ).href
  );
  const measurements = [];
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
  for (const [name, input] of Object.entries(await imageFixtures())) {
    if (only && name !== only) continue;
    const inputFormat = (await sharp(input).metadata()).format;
    await writeFile(
      join(
        dir,
        `${name}-source.${inputFormat === "jpeg" ? "jpg" : inputFormat}`,
      ),
      input,
    );
    const start = performance.now();
    const result = await convertSticker(input);
    const ms = performance.now() - start;
    const output = Buffer.from(result.data, "base64");
    await writeFile(join(dir, `${name}-${label}.webp`), output);
    const meta = await sharp(output, { animated: true }).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.pageHeight || meta.height, 512);
    assert.ok(result.bytes <= (result.animated ? 500 : 100) * 1024);
    measurements.push({
      name,
      ms: +ms.toFixed(1),
      bytes: result.bytes,
      frames: meta.pages || 1,
      durationMs: meta.delay?.reduce((sum, n) => sum + n, 0) || 0,
      ...(await visibleMetrics(input, output)),
    });
    console.log(measurements.at(-1));
  }
  await writeFile(
    join(dir, `${label}${only ? `-${only}` : ""}.json`),
    JSON.stringify(measurements, null, 2),
  );
}
void main();
