import { unzipSync, type UnzipFileInfo } from "fflate";

export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGES = 500;
const MAX_ENTRIES = 2000;

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

export type ZipImage = {
  path: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
};

export function isZip(asset: { name: string; mimeType?: string }) {
  return (
    /\.zip$/i.test(asset.name) ||
    /^(application\/zip|application\/x-zip(?:-compressed)?)(?:;|$)/i.test(
      asset.mimeType || "",
    )
  );
}

function imagePath(name: string) {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.includes("\0") ||
    parts.some((part) => part.startsWith(".") || part === "__MACOSX")
  )
    return null;
  const extension = parts.at(-1)?.split(".").at(-1)?.toLowerCase() || "";
  return Object.hasOwn(imageTypes, extension) ? normalized : null;
}

function fingerprint(data: Uint8Array) {
  let hash = 2166136261;
  for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
  return `${data.length}:${hash >>> 0}`;
}

/** Read metadata before inflating anything, so oversized ZIPs fail early. */
export function readStickerZip(data: Uint8Array, filename: string) {
  if (data.length > MAX_ZIP_BYTES)
    throw new Error("Choose a ZIP smaller than 100 MB.");
  if (data.length < 22)
    throw new Error(
      "This ZIP couldn't be opened. Choose a valid, unencrypted ZIP.",
    );
  const entries: UnzipFileInfo[] = [];
  let expanded = 0;
  try {
    unzipSync(data, {
      filter: (entry) => {
        entries.push(entry);
        expanded += entry.originalSize;
        if (entries.length > MAX_ENTRIES)
          throw new Error(
            "This ZIP contains too many files. Keep it below 2,000 entries.",
          );
        if (!Number.isSafeInteger(expanded) || expanded > MAX_EXPANDED_BYTES)
          throw new Error("This ZIP expands beyond the 200 MB limit.");
        return false;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("This ZIP"))
      throw error;
    throw new Error(
      "This ZIP couldn't be opened. Choose a valid, unencrypted ZIP.",
    );
  }

  let candidates = entries.filter((entry) => imagePath(entry.name));
  // Sticker bundles commonly include full sheets or cover art next to stickers/.
  const inStickerFolder = (entry: UnzipFileInfo) =>
    /(?:^|\/)stickers\//i.test(imagePath(entry.name) || "");
  if (candidates.some(inStickerFolder))
    candidates = candidates.filter(inStickerFolder);
  if (!candidates.length)
    throw new Error("This ZIP contains no supported sticker images.");
  if (candidates.length > MAX_IMAGES)
    throw new Error(
      "This ZIP contains more than 500 images. Split it into smaller ZIPs.",
    );
  if (candidates.some((entry) => entry.originalSize > MAX_IMAGE_BYTES))
    throw new Error("Images in a ZIP must be smaller than 50 MB.");

  candidates.sort((a, b) =>
    a.name.localeCompare(b.name, "en", { numeric: true }),
  );
  const paths = new Set(candidates.map((entry) => entry.name));
  if (paths.size !== candidates.length)
    throw new Error(
      "This ZIP contains repeated file paths. Rename the files and try again.",
    );
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (entry) => paths.has(entry.name) });
  } catch {
    throw new Error(
      "This ZIP couldn't be opened. Choose a valid, unencrypted ZIP.",
    );
  }

  const images: ZipImage[] = [];
  const seen = new Map<string, Uint8Array[]>();
  let duplicates = 0;
  for (const entry of candidates) {
    const bytes = files[entry.name];
    if (!bytes || bytes.length !== entry.originalSize)
      throw new Error(
        "This ZIP contains a damaged image. Create the ZIP again and retry.",
      );
    const key = fingerprint(bytes);
    const matches = seen.get(key) || [];
    if (matches.some((other) => bytes.every((byte, i) => byte === other[i]))) {
      duplicates++;
      continue;
    }
    matches.push(bytes);
    seen.set(key, matches);
    const name = entry.name.replace(/\\/g, "/").split("/").at(-1)!;
    images.push({
      path: entry.name,
      name,
      mimeType: imageTypes[name.split(".").at(-1)!.toLowerCase()],
      data: bytes,
    });
  }
  const name = filename
    .replace(/\.zip$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 70);
  return { images, duplicates, name: name || "Imported stickers" };
}
