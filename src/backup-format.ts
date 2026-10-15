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
    value.search(nonBase64) === (padding ? value.length - padding : -1)
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
function validatePacks(packs: unknown): asserts packs is Pack[] {
  if (!Array.isArray(packs) || packs.length > 500) throw invalid();
  const ids = new Set<string>();
  for (const p of packs) {
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
  }
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
    !("packs" in value)
  )
    throw invalid();
  validatePacks(value.packs);
  return value.packs.map(cleanPack);
}
export function serializeBackup(packs: Pack[]): string {
  const cleaned = packs.map(cleanPack);
  // Validate the same schema as import without parsing a second copy of every
  // embedded media string just to check the JSON we are about to write.
  validatePacks(cleaned);
  const raw = JSON.stringify({
    format: "peel-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    packs: cleaned,
  });
  if (raw.length > MAX_BACKUP_BYTES)
    throw new Error("This backup exceeds the 128 MB limit.");
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
  const ids = new Set(existing.map((pack) => pack.id));
  const candidates = new Map<string, Pack[]>();
  // A small metadata key avoids comparing embedded artwork against unrelated
  // packs. Full content comparison still decides equality within each bucket.
  const contentKey = (pack: Pack) =>
    JSON.stringify([
      pack.name,
      pack.color,
      pack.animated,
      pack.stickers.map((s) => [s.name, s.data.length, s.tray.length]),
    ]);
  for (const pack of existing) {
    const key = contentKey(pack);
    const bucket = candidates.get(key);
    if (bucket) bucket.push(pack);
    else candidates.set(key, [pack]);
  }
  let added = 0;
  for (const pack of incoming) {
    const key = contentKey(pack);
    const bucket = candidates.get(key);
    if (bucket?.some((p) => sameContent(p, pack))) continue;
    let id = pack.id;
    let suffix = 1;
    while (ids.has(id)) id = `${pack.id.slice(0, 80)}-restored-${suffix++}`;
    const restored = { ...pack, id };
    packs.push(restored);
    ids.add(id);
    if (bucket) bucket.push(restored);
    else candidates.set(key, [restored]);
    added++;
  }
  return { packs, added, skipped: incoming.length - added };
}
