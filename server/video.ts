import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { fitDetailedSticker } from "./fit-detailed-sticker";
import { findFittingQuality } from "./quality-search";
const exec = promisify(execFile);
export async function convertVideo(input: Buffer, start = 0, duration = 3) {
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    start > 36000 ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 6
  )
    throw Error("Choose a start time and a clip between 1 and 6 seconds.");
  if (input.length > 100 * 1024 * 1024)
    throw Error("Choose a video smaller than 100 MB.");
  const atom = input.toString("ascii", 4, 8);
  const webm = input
    .subarray(0, 4)
    .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!webm && !["ftyp", "moov", "mdat", "wide", "free"].includes(atom))
    throw Error("Choose an MP4, MOV or WebM video.");
  const dir = await mkdtemp(join(tmpdir(), "peel-"));
  try {
    const source = join(dir, "source");
    const out = join(dir, "sticker.webp");
    await writeFile(source, input);
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
        source,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const meta = JSON.parse(stdout);
    const stream = meta.streams?.[0];
    if (!stream || stream.width * stream.height > 34_000_000)
      throw Error("Choose a video at 8K resolution or below.");
    if (
      !Number.isFinite(Number(meta.format?.duration)) ||
      start >= Number(meta.format.duration) - 0.1
    )
      throw Error("The start time is beyond the end of this video.");
    const filter =
      "fps=15,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000";
    const sourceArgs = [
      "-ss",
      String(start),
      "-threads",
      "2",
      "-i",
      source,
      "-t",
      String(duration),
      "-an",
      "-vf",
      filter,
    ];
    const encode = async (quality: number, inputArgs: string[]) => {
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          ...inputArgs,
          "-c:v",
          "libwebp_anim",
          "-quality",
          String(quality),
          "-compression_level",
          "4",
          "-loop",
          "0",
          "-threads",
          "2",
          out,
        ],
        { timeout: 45_000, maxBuffer: 1024 * 1024 },
      );
      return readFile(out);
    };
    const fits = async (data: Buffer) => {
      if (data.length > 500 * 1024) return false;
      const info = await sharp(data, { animated: true }).metadata();
      const animated = (info.pages || 1) > 1;
      return animated || data.length <= 100 * 1024;
    };
    const result = async (data: Buffer, quality: number) => {
      const info = await sharp(data, { animated: true }).metadata();
      const tray = await sharp(data, { page: 0 })
        .resize(96, 96)
        .png()
        .toBuffer();
      return {
        data: data.toString("base64"),
        tray: tray.toString("base64"),
        animated: (info.pages || 1) > 1,
        bytes: data.length,
        width: 512,
        height: 512,
        quality,
      };
    };
    // Most clips fit immediately. Keep that path to one decode and one encode.
    let first: Buffer | undefined = await encode(95, sourceArgs);
    if (await fits(first)) return result(first, 95);

    // Decode and scale the selected original clip only once for all retries.
    // A bounded temporary file avoids retaining a full RGBA animation in JS.
    const rawPath = join(dir, "frames.rgba");
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        ...sourceArgs,
        "-frames:v",
        String(Math.ceil(duration * 15)),
        "-c:v",
        "rawvideo",
        "-f",
        "rawvideo",
        "-threads",
        "2",
        rawPath,
      ],
      { timeout: 45_000, maxBuffer: 1024 * 1024 },
    );
    const frameBytes = 512 * 512 * 4;
    const rawBytes = (await stat(rawPath)).size;
    const pages = rawBytes / frameBytes;
    if (!Number.isInteger(pages) || pages < 1 || pages > 90)
      throw Error("Could not read this video.");
    const rawArgs = [
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      "512x512",
      "-framerate",
      "15",
      "-i",
      rawPath,
      "-an",
    ];
    const selected = await findFittingQuality(
      async (quality) => {
        const data =
          first && quality === 95 ? first : await encode(quality, rawArgs);
        first = undefined;
        return { value: data, fits: await fits(data), bytes: data.length };
      },
      500 * 1024,
      25,
      95,
    );
    if (selected) return result(selected.value, selected.quality);

    // Fallback starts from original decoded pixels, not an already lossy WebP.
    const delays = Array.from(
      { length: pages },
      (_, page) =>
        Math.round(((page + 1) * 1000) / 15) - Math.round((page * 1000) / 15),
    );
    const data = await fitDetailedSticker(
      await readFile(rawPath),
      pages > 1,
      delays,
      500 * 1024,
      { width: 512, height: 512 * pages, channels: 4, pageHeight: 512 },
    );
    return result(data, 65);
  } catch (e) {
    if (e instanceof Error && "code" in e)
      throw Error(
        "Could not read this video. Try an MP4 or MOV file with a shorter clip.",
      );
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
