import { isPack, type Pack, type Sticker } from "./library-store";

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const invalid = () =>
  new Error("This isn't a valid Peel backup. Your packs haven't changed.");
const nonBase64 = /[^A-Za-z0-9+/]/;
function validMedia(value: string, prefix: string, maxBytes: number) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (
    value.length >= 32 &&
    value.length % 4 === 0 &&
    (value.length * 3) / 4 - padding <= maxBytes &&
    value.startsWith(prefix) &&
    !nonBase64.test(value.slice(0, value.length - padding))
  );
}
function cleanSticker(s: Sticker): Sticker {
  return {
    id: s.id,
    name: s.name,
    data: s.data,
    tray: s.tray,
    animated: s.animated,
    bytes: s.bytes,
  };
}
function cleanPack(p: Pack): Pack {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    animated: p.animated,
    createdAt: p.createdAt,
    stickers: p.stickers.map(cleanSticker),
    ...(p.starter === true ? { starter: true } : {}),
  };
}
export function parseBackup(raw: string): Pack[] {
  if (raw.length > MAX_BACKUP_BYTES)
    throw new Error("This backup exceeds the 128 MB limit.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("format" in value) ||
    value.format !== "peel-backup" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("packs" in value) ||
    !Array.isArray(value.packs) ||
    value.packs.length > 500
  )
    throw invalid();
  const ids = new Set<string>();
  return value.packs.map((p: unknown) => {
    if (
      !isPack(p) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) ||
      ids.has(p.id) ||
      !p.name.trim() ||
      p.name.length > 70 ||
      !/^#[0-9a-f]{6}$/i.test(p.color) ||
      !Number.isFinite(Date.parse(p.createdAt))
    )
      throw invalid();
    ids.add(p.id);
    const stickerIds = new Set<string>();
    for (const s of p.stickers) {
      if (
        !s.id ||
        s.id.length > 200 ||
        stickerIds.has(s.id) ||
        !s.name.trim() ||
        s.name.length > 125 ||
        s.animated !== p.animated ||
        !validMedia(s.data, "UklGR", s.animated ? 512000 : 102400) ||
        !validMedia(s.tray, "iVBORw0KGgo", 102400)
      )
        throw invalid();
      stickerIds.add(s.id);
    }
    return cleanPack(p);
  });
}
export function serializeBackup(packs: Pack[]): string {
  const raw = JSON.stringify({
    format: "peel-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    packs: packs.map(cleanPack),
  });
  parseBackup(raw); // Verify the backup can be restored before writing it.
  return raw;
}
function sameContent(a: Pack, b: Pack) {
  return (
    a.name === b.name &&
    a.color === b.color &&
    a.animated === b.animated &&
    a.stickers.length === b.stickers.length &&
    a.stickers.every(
      (s, i) =>
        s.name === b.stickers[i].name &&
        s.data === b.stickers[i].data &&
        s.tray === b.stickers[i].tray,
    )
  );
}
export function mergeBackup(existing: Pack[], incoming: Pack[]) {
  const packs = [...existing];
  let added = 0;
  for (const pack of incoming) {
    if (packs.some((p) => sameContent(p, pack))) continue;
    let id = pack.id;
    let suffix = 1;
    while (packs.some((p) => p.id === id))
      id = `${pack.id.slice(0, 80)}-restored-${suffix++}`;
    packs.push({ ...pack, id });
    added++;
  }
  return { packs, added, skipped: incoming.length - added };
}
