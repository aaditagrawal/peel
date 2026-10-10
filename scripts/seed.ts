import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import { convertSticker } from "../server/convert";
const groups = [
  {
    id: "good-vibes",
    name: "Good vibes only",
    color: "#F8E6C8",
    emoji: ["1f60e", "1f525", "1f44c", "1f389", "1f4af", "1f31e"],
  },
  {
    id: "little-moods",
    name: "Little moods",
    color: "#E7EACC",
    emoji: ["1f979", "1f62d", "1f644", "1f634", "1f971", "1f60d"],
  },
  {
    id: "snack-club",
    name: "The snack club",
    color: "#F4DFD7",
    emoji: ["1f951", "1f355", "1f352", "1f950", "2615", "1f353"],
  },
];
await mkdir("assets/stickers", { recursive: true });
const packs = [];
for (const group of groups) {
  const stickers = [];
  for (const code of group.emoji) {
    const response = await fetch(
      `https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg/${code}.svg`,
    );
    if (!response.ok) throw Error(`Missing art ${code}`);
    const png = await sharp(Buffer.from(await response.text()))
      .resize(420, 420)
      .extend({
        top: 46,
        bottom: 46,
        left: 46,
        right: 46,
        background: "#00000000",
      })
      .png()
      .toBuffer();
    const result = await convertSticker(png);
    await writeFile(
      `assets/stickers/${code}.webp`,
      Buffer.from(result.data, "base64"),
    );
    stickers.push({
      id: code,
      name: String.fromCodePoint(
        ...code.split("-").map((c) => parseInt(c, 16)),
      ),
      ...result,
    });
  }
  packs.push({
    id: group.id,
    name: group.name,
    color: group.color,
    animated: false,
    createdAt: "2026-10-05T00:00:00Z",
    stickers,
    starter: true,
  });
}
await writeFile("src/starter-packs.json", JSON.stringify(packs));
