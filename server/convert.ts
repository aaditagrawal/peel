import sharp from "sharp";
import { fitDetailedSticker } from "./fit-detailed-sticker";

export async function convertSticker(input: Buffer) {
  if (input.length > 50 * 1024 * 1024)
    throw new Error("Choose a file smaller than 50 MB.");
  const meta = await sharp(input, {
    animated: true,
    limitInputPixels: 100_000_000,
  }).metadata();
  if (!["jpeg", "png", "gif", "webp", "heif"].includes(meta.format || ""))
    throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  const animated = (meta.pages || 1) > 1;
  if ((meta.pages || 1) > 150)
    throw new Error("Choose a GIF with 150 frames or fewer.");
  const delay = (meta.delay || []).map((n) => Math.max(n, 8));
  if (animated && delay.reduce((a, b) => a + b, 0) > 10_000)
    throw new Error("Choose a GIF that is 10 seconds or shorter.");
  const limit = animated ? 500 * 1024 : 100 * 1024;
  let output: Buffer | undefined;
  for (const quality of [100, 95, 90, 85, 80, 72, 60, 45, 30]) {
    const candidate = await sharp(input, {
      animated: true,
      limitInputPixels: 100_000_000,
    })
      .autoOrient()
      .resize(512, 512, { fit: "contain", background: "#00000000" })
      .webp({
        quality,
        lossless: quality === 100,
        effort: 5,
        loop: 0,
        ...(animated ? { delay } : {}),
      })
      .toBuffer();
    if (candidate.length <= limit) {
      const candidateMeta = await sharp(candidate, {
        animated: true,
      }).metadata();
      if ((candidateMeta.pages || 1) === 1 && candidate.length > 100 * 1024)
        continue;
      output = candidate;
      break;
    }
  }
  if (!output) output = await fitDetailedSticker(input, animated, delay, limit);
  const outputMeta = await sharp(output, { animated: true }).metadata();
  const tray = await sharp(input, { page: 0 })
    .autoOrient()
    .resize(96, 96, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
  return {
    data: output.toString("base64"),
    tray: tray.toString("base64"),
    animated: (outputMeta.pages || 1) > 1,
    bytes: output.length,
    width: 512,
    height: 512,
  };
}
