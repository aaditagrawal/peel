import sharp from "sharp";
import { fitDetailedSticker } from "./fit-detailed-sticker";
import { findFittingQuality } from "./quality-search";

function completeStickerContainer(input: Buffer, delays: number[] | undefined) {
  if (
    !delays ||
    input.length < 12 ||
    input.toString("ascii", 0, 4) !== "RIFF" ||
    input.toString("ascii", 8, 12) !== "WEBP" ||
    input.readUInt32LE(4) + 8 !== input.length
  )
    return false;
  let offset = 12;
  let frame = 0;
  while (offset + 8 <= input.length) {
    const size = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > input.length) return false;
    if (input.toString("ascii", offset, offset + 4) === "ANMF") {
      if (size < 16) return false;
      const delay = input.readUIntLE(offset + 8 + 12, 3);
      // libvips reports very short delays as 100ms. Inspect the actual container
      // too, so that metadata normalization cannot hide an invalid frame delay.
      if (delay < 8 || delay !== delays[frame++]) return false;
    }
    offset = end;
  }
  return offset === input.length && frame === delays.length;
}

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
  if (
    meta.format === "webp" &&
    meta.width === 512 &&
    (meta.pageHeight || meta.height) === 512 &&
    meta.space === "srgb" &&
    !meta.hasProfile &&
    (meta.orientation === undefined || meta.orientation === 1) &&
    !meta.exif &&
    !meta.icc &&
    !meta.xmp &&
    !meta.iptc &&
    completeStickerContainer(input, animated ? meta.delay : []) &&
    input.length <= limit &&
    (!animated ||
      (meta.loop === 0 &&
        meta.delay?.length === meta.pages &&
        meta.delay?.every((n) => n >= 8)))
  ) {
    // Metadata only reads the header. Decode every frame before preserving an
    // existing sticker byte-for-byte, avoiding another lossy generation.
    await sharp(input, {
      animated: true,
      limitInputPixels: 100_000_000,
      failOn: "warning",
    }).stats();
    output = input;
  }
  const encode = async (quality: number, lossless = false) => {
    const candidate = await sharp(input, {
      animated: true,
      limitInputPixels: 100_000_000,
    })
      .autoOrient()
      .resize(512, 512, { fit: "contain", background: "#00000000" })
      .webp({
        quality,
        lossless,
        alphaQuality: 100,
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
        return { value: candidate, fits: false, bytes: candidate.length };
      return { value: candidate, fits: true, bytes: candidate.length };
    }
    return { value: candidate, fits: false, bytes: candidate.length };
  };
  if (!output) {
    const lossless = await encode(100, true);
    if (lossless.fits) output = lossless.value;
    else output = (await findFittingQuality(encode, limit))?.value;
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
