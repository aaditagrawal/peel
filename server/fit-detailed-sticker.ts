import sharp from "sharp";

// Used only after normal quality adjustments fail. Keep the canvas and timeline;
// reduce the amount of visual information that must fit in WhatsApp's byte cap.
const fallbackSteps = [
  { side: 384, fps: 12 },
  { side: 256, fps: 10 },
  { side: 192, fps: 8 },
  { side: 128, fps: 6 },
  { side: 96, fps: 4 },
  { side: 64, fps: 2 },
  { side: 32, fps: 2 },
];

export async function fitDetailedSticker(
  input: Buffer,
  animated: boolean,
  delays: number[],
  limit: number,
): Promise<Buffer> {
  for (const { side, fps } of fallbackSteps) {
    const { data, info } = await sharp(input, {
      animated,
      limitInputPixels: 100_000_000,
    })
      .autoOrient()
      .resize(side, side, { fit: "contain", background: "#00000000" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frameBytes = side * side * 4;
    const pages = info.height / side;
    const frames: Buffer[] = [];
    const selectedPages: number[] = [];
    const timing: number[] = [];
    let nextSample = 0;
    let elapsed = 0;
    for (let page = 0; page < pages; page++) {
      // Select the frame at each sample boundary and give it all skipped time.
      // Unlike simply dropping frames, this never speeds up or truncates a GIF.
      if (
        frames.length === 0 ||
        elapsed >= nextSample ||
        (frames.length === 1 && page === pages - 1)
      ) {
        frames.push(data.subarray(page * frameBytes, (page + 1) * frameBytes));
        selectedPages.push(page);
        timing.push(0);
        nextSample = elapsed + 1000 / fps;
      }
      const delay = delays[page] ?? 100;
      timing[timing.length - 1] += delay;
      elapsed += delay;
    }
    // A short burst of motion can fall entirely between regular samples.
    // Retain a differing source frame rather than flattening that animation.
    if (frames.length > 1 && frames.every((frame) => frame.equals(frames[0]))) {
      for (let page = 1; page < pages; page++) {
        const frame = data.subarray(page * frameBytes, (page + 1) * frameBytes);
        if (!frame.equals(frames[0])) {
          let nearest = 1;
          for (let i = 2; i < selectedPages.length; i++) {
            if (
              Math.abs(selectedPages[i] - page) <
              Math.abs(selectedPages[nearest] - page)
            )
              nearest = i;
          }
          frames[nearest] = frame;
          break;
        }
      }
    }
    // Resize separately: Sharp's raw pageHeight is not updated by resize, so
    // resizing a raw animation stack can turn it into a malformed static image.
    const expanded: Buffer[] = [];
    for (const frame of frames) {
      expanded.push(
        await sharp(frame, {
          raw: { width: side, height: side, channels: 4 },
        })
          .resize(512, 512, { kernel: "cubic" })
          .raw()
          .toBuffer(),
      );
    }
    const candidate = await sharp(Buffer.concat(expanded), {
      raw: {
        width: 512,
        height: 512 * frames.length,
        channels: 4,
        pageHeight: 512,
      },
    })
      .webp({
        quality: 65,
        effort: 2,
        loop: 0,
        ...(animated ? { delay: timing } : {}),
      })
      .toBuffer();
    // An encoder may merge identical frames into a static image.
    const meta = await sharp(candidate, { animated: true }).metadata();
    const actualLimit =
      (meta.pages || 1) > 1 ? limit : Math.min(limit, 100 * 1024);
    if (candidate.length <= actualLimit) return candidate;
  }
  throw new Error(
    "Could not finish converting this file. Please try importing it again.",
  );
}
