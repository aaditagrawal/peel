import sharp from "sharp";

export async function texturedPhotoFixture() {
  const photoPixels = Buffer.alloc(512 * 512 * 3);
  let seed = 49201;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = ((seed >>> 24) - 128) * 0.35;
      const i = (y * 512 + x) * 3;
      photoPixels[i] = Math.max(
        0,
        Math.min(255, 110 + 70 * Math.sin(x / 41) + noise),
      );
      photoPixels[i + 1] = Math.max(
        0,
        Math.min(255, 120 + 65 * Math.cos(y / 57) + noise),
      );
      photoPixels[i + 2] = Math.max(
        0,
        Math.min(255, 100 + 55 * Math.sin((x + y) / 73) + noise),
      );
    }
  }
  return sharp(photoPixels, {
    raw: { width: 512, height: 512, channels: 3 },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

export async function imageFixtures() {
  const text = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect x="16" y="16" width="480" height="480" rx="60" fill="#f7bc54" fill-opacity=".65"/>
    <path d="M32 340L480 172M32 172L480 340" stroke="#e33857" stroke-width="3"/>
    <circle cx="256" cy="210" r="104" fill="none" stroke="#193c83" stroke-width="2"/>
    <text x="256" y="260" font-family="sans-serif" font-size="64" font-weight="bold" text-anchor="middle" fill="#193c83">Peel!</text>
    <text x="256" y="380" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#193c83">Keep tiny type &amp; transparent edges.</text>
  </svg>`),
  )
    .png()
    .toBuffer();
  const photo = await texturedPhotoFixture();
  const detailedPixels = Buffer.alloc(512 * 512 * 4);
  let seed = 2417;
  for (let i = 0; i < detailedPixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    detailedPixels[i] = seed >>> 24;
  }
  const detailed = await sharp(detailedPixels, {
    raw: { width: 512, height: 512, channels: 4 },
  })
    .png()
    .toBuffer();
  const width = 512;
  const height = 256;
  const pages = 24;
  const animationPixels = Buffer.alloc(width * height * pages * 4);
  seed = 91827;
  for (let i = 0; i < animationPixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    animationPixels[i] = seed & 255;
    animationPixels[i + 1] = (seed >>> 8) & 255;
    animationPixels[i + 2] = (seed >>> 16) & 255;
    animationPixels[i + 3] = 255;
  }
  const animation = await sharp(animationPixels, {
    raw: { width, height: height * pages, channels: 4, pageHeight: height },
  })
    .gif({
      delay: Array.from({ length: pages }, (_, i) => (i % 2 ? 80 : 120)),
      loop: 0,
      effort: 1,
    })
    .toBuffer();
  return {
    "text-edges": text,
    "photo-texture": photo,
    "webp-reimport": await sharp(photo)
      .webp({ quality: 72, effort: 5 })
      .toBuffer(),
    "detailed-alpha": detailed,
    "detailed-animation": animation,
  };
}
