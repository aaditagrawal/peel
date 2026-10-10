import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { convertSticker } from "./convert";
import { convertVideo } from "./video";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("photo is fitted, not distorted, with transparent padding and compliant tray", async () => {
  const input = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "#e84826" },
  })
    .jpeg()
    .toBuffer();
  const output = await convertSticker(input);
  const webp = Buffer.from(output.data, "base64");
  const meta = await sharp(webp).metadata();
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.format, "webp");
  assert.equal(output.animated, false);
  assert.ok(webp.length <= 100 * 1024);
  const { data, info } = await sharp(webp)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0);
  assert.equal(data[(256 * info.width + 256) * 4 + 3], 255);
  const tray = await sharp(Buffer.from(output.tray, "base64")).metadata();
  assert.equal(tray.width, 96);
  assert.equal(tray.height, 96);
});
test("GIF animation survives with timing and dimensions intact", async () => {
  const frame1 = Buffer.alloc(40 * 40 * 4);
  const frame2 = Buffer.alloc(40 * 40 * 4);
  for (let i = 0; i < frame1.length; i += 4) {
    frame1[i] = 255;
    frame1[i + 3] = 255;
    frame2[i + 1] = 255;
    frame2[i + 3] = 255;
  }
  const gif = await sharp(Buffer.concat([frame1, frame2]), {
    raw: { width: 40, height: 80, channels: 4, pageHeight: 40 },
  })
    .gif({ delay: [100, 200], loop: 0 })
    .toBuffer();
  const output = await convertSticker(gif);
  const meta = await sharp(Buffer.from(output.data, "base64"), {
    animated: true,
  }).metadata();
  assert.equal(output.animated, true);
  assert.equal(meta.width, 512);
  assert.equal(meta.pageHeight, 512);
  assert.equal(meta.pages, 2);
  assert.deepEqual(meta.delay, [100, 200]);
  assert.ok(output.bytes <= 500 * 1024);
});
test("rejects corrupt media and oversized images", async () => {
  await assert.rejects(convertSticker(Buffer.from("not an image")));
  await assert.rejects(convertSticker(Buffer.alloc(51 * 1024 * 1024)), /50 MB/);
});
test("rejects GIFs longer than WhatsApp permits", async () => {
  const gif = await sharp({
    create: { width: 10, height: 20, channels: 4, background: "red" },
    raw: { width: 10, height: 20, channels: 4, pageHeight: 10 },
  })
    .gif({ delay: [6000, 6000] })
    .toBuffer();
  // Build two visually distinct frames so the encoder cannot collapse them.
  const frames = Buffer.concat([Buffer.alloc(400, 255), Buffer.alloc(400, 80)]);
  const actual = await sharp(frames, {
    raw: { width: 10, height: 20, channels: 4, pageHeight: 10 },
  })
    .gif({ delay: [6000, 6000] })
    .toBuffer();
  await assert.rejects(convertSticker(actual), /10 seconds/);
});
test("video clip becomes compliant animated WebP; invalid range is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "peel-test-"));
  try {
    const path = join(dir, "test.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=15",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    const input = await readFile(path);
    const output = await convertVideo(input, 0, 1);
    const meta = await sharp(Buffer.from(output.data, "base64"), {
      animated: true,
    }).metadata();
    assert.equal(output.animated, true);
    assert.equal(meta.width, 512);
    assert.equal(meta.pageHeight, 512);
    assert.ok(output.bytes <= 500 * 1024);
    await assert.rejects(convertVideo(input, 12, 2), /beyond/);
    await assert.rejects(convertVideo(input, 0, 20), /between 1 and 6/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "detailed GIF automatically fits without losing duration, aspect ratio or transparency",
  { timeout: 120_000 },
  async () => {
    const width = 512;
    const height = 256;
    const pages = 24;
    const pixels = Buffer.alloc(width * height * pages * 4);
    let seed = 91827;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[i] = seed & 255;
      pixels[i + 1] = (seed >>> 8) & 255;
      pixels[i + 2] = (seed >>> 16) & 255;
      pixels[i + 3] = 255;
    }
    const delays = Array.from({ length: pages }, (_, i) => (i % 2 ? 80 : 120));
    const gif = await sharp(pixels, {
      raw: { width, height: height * pages, channels: 4, pageHeight: height },
    })
      .gif({ delay: delays, loop: 0, effort: 1 })
      .toBuffer();
    // Prove this fixture reaches the new path: the old minimum quality is too large.
    const oldMinimum = await sharp(gif, { animated: true })
      .resize(512, 512, { fit: "contain", background: "#00000000" })
      .webp({ quality: 30, effort: 5, delay: delays, loop: 0 })
      .toBuffer();
    assert.ok(oldMinimum.length > 500 * 1024);
    const output = await convertSticker(gif);
    assert.ok(output.bytes <= 500 * 1024);
    assert.equal(output.animated, true);
    const data = Buffer.from(output.data, "base64");
    const meta = await sharp(data, { animated: true }).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.pageHeight, 512);
    assert.equal(
      meta.delay?.reduce((sum, delay) => sum + delay, 0),
      2400,
    );
    assert.equal(meta.loop, 0);
    const frame = await sharp(data, { page: 0 }).ensureAlpha().raw().toBuffer();
    assert.equal(frame[3], 0);
    assert.equal(frame[(256 * 512 + 256) * 4 + 3], 255);
  },
);

test(
  "a detailed video automatically reduces detail while keeping the selected clip",
  { timeout: 120_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "peel-detailed-video-"));
    try {
      const path = join(dir, "noise.mp4");
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "nullsrc=s=512x256:r=15,noise=alls=100:allf=t+u:all_seed=17",
        "-t",
        "3",
        "-c:v",
        "libx264",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv420p",
        path,
      ]);
      const output = await convertVideo(await readFile(path), 0, 3);
      assert.ok(output.bytes <= 500 * 1024);
      assert.equal(output.animated, true);
      const meta = await sharp(Buffer.from(output.data, "base64"), {
        animated: true,
      }).metadata();
      assert.equal(meta.width, 512);
      assert.equal(meta.pageHeight, 512);
      // The last ffmpeg packet can differ from the source by one 15fps frame.
      assert.ok(
        Math.abs(
          (meta.delay || []).reduce((sum, delay) => sum + delay, 0) - 3000,
        ) <= 70,
      );
      assert.equal(output.quality, 65, "fixture must use the detail fallback");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "detailed transparent images automatically fit the static sticker cap",
  { timeout: 60_000 },
  async () => {
    const pixels = Buffer.alloc(512 * 512 * 4);
    let seed = 2417;
    for (let i = 0; i < pixels.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[i] = seed >>> 24;
    }
    const input = await sharp(pixels, {
      raw: { width: 512, height: 512, channels: 4 },
    })
      .png()
      .toBuffer();
    const oldMinimum = await sharp(input)
      .webp({ quality: 30, effort: 5 })
      .toBuffer();
    assert.ok(oldMinimum.length > 100 * 1024);
    const output = await convertSticker(input);
    assert.equal(output.animated, false);
    assert.ok(output.bytes <= 100 * 1024);
    const meta = await sharp(Buffer.from(output.data, "base64")).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
    assert.equal(meta.hasAlpha, true);
  },
);

test("detail fitting keeps motion that falls between temporal samples", async () => {
  const { fitDetailedSticker } = await import("./fit-detailed-sticker");
  const pixels = Buffer.alloc(32 * 32 * 4 * 10);
  for (let frame = 0; frame < 10; frame++) {
    for (let pixel = 0; pixel < 32 * 32; pixel++) {
      const offset = (frame * 32 * 32 + pixel) * 4;
      pixels[offset + (frame === 1 ? 1 : 0)] = 255;
      pixels[offset + 3] = 255;
    }
  }
  const input = await sharp(pixels, {
    raw: { width: 32, height: 320, channels: 4, pageHeight: 32 },
  })
    .gif({ delay: Array(10).fill(40), loop: 0, keepDuplicateFrames: true })
    .toBuffer();
  const output = await fitDetailedSticker(
    input,
    true,
    Array(10).fill(40),
    500 * 1024,
  );
  const meta = await sharp(output, { animated: true }).metadata();
  assert.ok((meta.pages || 1) > 1);
  assert.equal(
    meta.delay?.reduce((sum, n) => sum + n, 0),
    400,
  );
});
