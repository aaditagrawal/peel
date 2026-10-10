import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" rx="220" fill="#F8F7F2"/><g transform="translate(245 215) rotate(-8 260 280)"><path d="M80 0H440Q520 0 520 80V340L340 560H80Q0 560 0 480V80Q0 0 80 0" fill="#576BFF"/><path d="M340 560V420Q340 340 420 340H520" fill="#AEB8FF"/><circle cx="160" cy="225" r="23" fill="#fff"/><circle cx="350" cy="225" r="23" fill="#fff"/><path d="M150 315Q245 410 335 315" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round"/></g></svg>`;
for (const [file, size] of [
  ["icon.png", 1024],
  ["adaptive-icon.png", 1024],
  ["favicon.png", 64],
] as const)
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`assets/${file}`);
