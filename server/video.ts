import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { fitDetailedSticker } from "./fit-detailed-sticker";
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
    let detailedSource: Buffer | undefined;
    for (const quality of [95, 85, 70, 55, 40, 25]) {
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-ss",
          String(start),
          "-i",
          source,
          "-t",
          String(duration),
          "-an",
          "-vf",
          "fps=15,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
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
      const data = await readFile(out);
      detailedSource ??= data;
      if (data.length > 500 * 1024) continue;
      const info = await sharp(data, { animated: true }).metadata();
      const animated = (info.pages || 1) > 1;
      if (!animated && data.length > 100 * 1024) continue;
      const tray = await sharp(data, { page: 0 })
        .resize(96, 96)
        .png()
        .toBuffer();
      return {
        data: data.toString("base64"),
        tray: tray.toString("base64"),
        animated,
        bytes: data.length,
        width: 512,
        height: 512,
        quality,
      };
    }
    if (!detailedSource) throw Error("Could not read this video.");
    const sourceMeta = await sharp(detailedSource, {
      animated: true,
    }).metadata();
    const data = await fitDetailedSticker(
      detailedSource,
      (sourceMeta.pages || 1) > 1,
      sourceMeta.delay || [],
      500 * 1024,
    );
    const info = await sharp(data, { animated: true }).metadata();
    const tray = await sharp(data, { page: 0 }).resize(96, 96).png().toBuffer();
    return {
      data: data.toString("base64"),
      tray: tray.toString("base64"),
      animated: (info.pages || 1) > 1,
      bytes: data.length,
      width: 512,
      height: 512,
      quality: 65,
    };
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
