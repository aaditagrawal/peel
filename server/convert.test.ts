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
import { texturedPhotoFixture } from "./media-fixtures";
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

test("textured images retain fine detail close to the byte cap", async () => {
  const input = await texturedPhotoFixture();
  const result = await convertSticker(input);
  const output = Buffer.from(result.data, "base64");
  const reference = await sharp(input).ensureAlpha().raw().toBuffer();
  const actual = await sharp(output).ensureAlpha().raw().toBuffer();
  let squared = 0;
  for (let i = 0; i < actual.length; i += 4)
    for (let c = 0; c < 3; c++)
      squared += (reference[i + c] - actual[i + c]) ** 2;
  const psnr = 10 * Math.log10(255 ** 2 / (squared / (512 * 512 * 3)));
  assert.ok(psnr > 34.8, `fine detail PSNR was ${psnr.toFixed(2)} dB`);
  assert.ok(output.length <= 100 * 1024);
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
  "video quality retries keep the selected start time and clip duration",
  { timeout: 60_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "peel-trim-retry-"));
    try {
      const path = join(dir, "colors.mp4");
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=512x256:r=15:d=1[red];color=c=lime:s=512x256:r=15:d=2[green];[red][green]concat=n=2:v=1:a=0,noise=alls=100:allf=t+u:all_seed=41",
        "-c:v",
        "libx264",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv420p",
        path,
      ]);
      const result = await convertVideo(await readFile(path), 1, 1);
      assert.ok(
        result.quality < 95,
        "fixture must exercise retries after the first encode",
      );
      assert.ok(result.bytes <= 500 * 1024);
      const output = Buffer.from(result.data, "base64");
      const meta = await sharp(output, { animated: true }).metadata();
      assert.ok(
        Math.abs((meta.delay?.reduce((sum, n) => sum + n, 0) || 0) - 1000) <=
          70,
      );
      const pixels = await sharp(output, { page: 0 })
        .ensureAlpha()
        .raw()
        .toBuffer();
      let red = 0;
      let green = 0;
      for (let y = 128; y < 384; y++) {
        for (let x = 0; x < 512; x++) {
          const i = (y * 512 + x) * 4;
          red += pixels[i];
          green += pixels[i + 1];
        }
      }
      assert.ok(
        (green - red) / (512 * 256) > 80,
        "selected clip must contain the green second, not the red opening",
      );
      assert.equal(pixels[3], 0);
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

test("already compliant static and animated WebP retain their original encoded pixels", async () => {
  const first = Buffer.alloc(512 * 512 * 4);
  const second = Buffer.alloc(first.length);
  for (let i = 0; i < first.length; i += 4) {
    first[i] = 240;
    first[i + 3] = 180;
    second[i + 1] = 210;
    second[i + 3] = 150;
  }
  const still = await sharp(first, {
    raw: { width: 512, height: 512, channels: 4 },
  })
    .webp({ quality: 61 })
    .toBuffer();
  const animated = await sharp(Buffer.concat([first, second]), {
    raw: { width: 512, height: 1024, channels: 4, pageHeight: 512 },
  })
    .webp({ quality: 61, delay: [90, 170], loop: 0 })
    .toBuffer();
  for (const input of [still, animated]) {
    const result = await convertSticker(input);
    assert.deepEqual(Buffer.from(result.data, "base64"), input);
    assert.equal(result.bytes, input.length);
    assert.equal(result.animated, input === animated);
  }
});

test("a corrupt later WebP frame is rejected even when its metadata is valid", async () => {
  const frames = Buffer.concat([
    Buffer.alloc(512 * 512 * 4, 255),
    Buffer.alloc(512 * 512 * 4, 70),
  ]);
  const input = await sharp(frames, {
    raw: { width: 512, height: 1024, channels: 4, pageHeight: 512 },
  })
    .webp({ lossless: true, delay: [100, 200], loop: 0 })
    .toBuffer();
  let lastFrame = 0;
  for (let offset = 12; offset + 8 < input.length;) {
    const size = input.readUInt32LE(offset + 4);
    if (input.toString("ascii", offset, offset + 4) === "ANMF")
      lastFrame = offset;
    offset += 8 + size + (size % 2);
  }
  assert.ok(lastFrame > 0);
  const corrupt = Buffer.from(input);
  const size = corrupt.readUInt32LE(lastFrame + 4);
  // Keep the ANMF/VP8L headers intact and destroy only the final frame pixels.
  corrupt.fill(0, lastFrame + 8 + 16 + 8 + 5, lastFrame + 8 + size);
  assert.equal((await sharp(corrupt, { animated: true }).metadata()).pages, 2);
  await assert.rejects(convertSticker(corrupt));
});

test("finite loops and sub-minimum WebP frame delays are normalized rather than preserved", async () => {
  const frames = Buffer.concat([
    Buffer.alloc(512 * 512 * 4, 255),
    Buffer.alloc(512 * 512 * 4, 70),
  ]);
  for (const options of [
    { loop: 2, delay: [100, 200] },
    { loop: 0, delay: [1, 7] },
  ]) {
    const input = await sharp(frames, {
      raw: { width: 512, height: 1024, channels: 4, pageHeight: 512 },
    })
      .webp({ lossless: true, ...options })
      .toBuffer();
    if (options.loop === 0) {
      // The Sharp encoder normalizes short delays while writing. Put actual
      // short delays into ANMF to exercise an externally supplied WebP.
      let frame = 0;
      for (let offset = 12; offset + 8 < input.length;) {
        const size = input.readUInt32LE(offset + 4);
        if (input.toString("ascii", offset, offset + 4) === "ANMF")
          input.writeUIntLE(options.delay[frame++], offset + 20, 3);
        offset += 8 + size + (size % 2);
      }
    }
    const result = await convertSticker(input);
    const output = Buffer.from(result.data, "base64");
    assert.notDeepEqual(output, input);
    const meta = await sharp(output, { animated: true }).metadata();
    assert.equal(meta.loop, 0);
    assert.ok(meta.delay?.every((n) => n >= 8));
    assert.deepEqual(meta.delay, options.loop ? [100, 200] : [100, 100]);
    assert.ok(output.length <= 500 * 1024);
  }
});

test("oriented metadata-bearing WebP is rendered upright and stripped before delivery", async () => {
  const pixels = Buffer.alloc(512 * 512 * 3);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      pixels[(y * 512 + x) * 3 + (x < 256 ? 0 : 2)] = 255;
    }
  }
  const input = await sharp(pixels, {
    raw: { width: 512, height: 512, channels: 3 },
  })
    .withMetadata({ orientation: 6 })
    .webp({ lossless: true })
    .toBuffer();
  const result = await convertSticker(input);
  const output = Buffer.from(result.data, "base64");
  assert.notDeepEqual(output, input);
  const meta = await sharp(output).metadata();
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.hasProfile, false);
  assert.equal(meta.exif, undefined);
  const reference = await sharp(input).autoOrient().raw().toBuffer();
  assert.deepEqual(await sharp(output).raw().toBuffer(), reference);
  assert.ok(output.length <= 100 * 1024);
});

test("WebP with trailing bytes is normalized to a complete RIFF container", async () => {
  const input = await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#b34a4acc" },
  })
    .webp({ lossless: true })
    .toBuffer();
  const trailing = Buffer.concat([
    input,
    Buffer.from("unrelated trailing bytes"),
  ]);
  const result = await convertSticker(trailing);
  const output = Buffer.from(result.data, "base64");
  assert.notDeepEqual(output, trailing);
  assert.equal(output.readUInt32LE(4) + 8, output.length);
  assert.ok(output.length <= 100 * 1024);
});

test("raw video fallback preserves frame order, motion, alpha and the exact timeline", async () => {
  const { fitDetailedSticker } = await import("./fit-detailed-sticker");
  const side = 512;
  const pages = 6;
  const pixels = Buffer.alloc(side * side * pages * 4);
  for (let page = 0; page < pages; page++) {
    for (let y = 128; y < 384; y++) {
      for (let x = 64; x < 448; x++) {
        const i = ((page * side + y) * side + x) * 4;
        pixels[i + (page < 3 ? 0 : 1)] = 255;
        pixels[i + 3] = 255;
      }
    }
  }
  const delays = [67, 66, 67, 67, 66, 67];
  const data = await fitDetailedSticker(pixels, true, delays, 500 * 1024, {
    width: side,
    height: side * pages,
    channels: 4,
    pageHeight: side,
  });
  const meta = await sharp(data, { animated: true }).metadata();
  assert.ok((meta.pages || 1) > 1);
  assert.equal(
    meta.delay?.reduce((sum, n) => sum + n, 0),
    400,
  );
  assert.equal(meta.pageHeight, side);
  const first = await sharp(data, { page: 0 }).ensureAlpha().raw().toBuffer();
  const last = await sharp(data, { page: (meta.pages || 1) - 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const center = (256 * side + 256) * 4;
  assert.ok(first[center] > 200 && first[center + 1] < 40);
  assert.ok(last[center + 1] > 200 && last[center] < 40);
  assert.equal(first[3], 0);
  assert.equal(last[3], 0);
});
