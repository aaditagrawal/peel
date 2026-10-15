import test from "node:test";
import assert from "node:assert/strict";
import starterPacks from "../src/starter-packs.json";
import {
  mergeBackup,
  parseBackup,
  serializeBackup,
} from "../src/backup-format";
import type { Pack } from "../src/library-store";

const original = starterPacks[0];
test("backup roundtrip includes embedded artwork and draft packs", () => {
  const draft = {
    ...original,
    id: "draft",
    stickers: original.stickers.slice(0, 1),
  };
  const result = parseBackup(serializeBackup([original, draft]));
  assert.equal(result.length, 2);
  assert.equal(result[0].stickers[0].data, original.stickers[0].data);
  assert.equal(result[1].stickers.length, 1);
});
test("malformed and unsupported backups reject before restore", () => {
  for (const raw of [
    "not json",
    "[]",
    JSON.stringify({ format: "peel-backup", version: 2, packs: [] }),
  ]) {
    assert.throws(() => parseBackup(raw));
  }
  for (const change of [
    { color: "url(https://example.com)" },
    { createdAt: "bad date" },
    {
      stickers: [
        { ...original.stickers[0], data: "file:///private/image.webp" },
      ],
    },
    { stickers: [{ ...original.stickers[0], animated: true }] },
    { stickers: Array(31).fill(original.stickers[0]) },
  ])
    assert.throws(() => serializeBackup([{ ...original, ...change }]));
  assert.throws(() => serializeBackup([original, original]));
});
test("restore keeps conflicting packs and deduplicates repeated restores", () => {
  const changed = { ...original, name: "Edited pack" };
  const first = mergeBackup([original], [changed]);
  assert.equal(first.added, 1);
  assert.equal(first.packs[0], original);
  assert.notEqual(first.packs[1].id, original.id);
  assert.equal(first.packs[1].name, "Edited pack");
  const again = mergeBackup(first.packs, [changed, original]);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.equal(again.packs.length, 2);
});

test("export and import apply the same media and record validation", () => {
  const pack = { ...original, stickers: original.stickers.slice(0, 1) };
  const rawBackup = (packs: Pack[]) =>
    JSON.stringify({ format: "peel-backup", version: 1, packs });
  const data = "UklGR" + "A".repeat(27);
  for (const padding of [0, 1, 2]) {
    const padded = data.slice(0, data.length - padding) + "=".repeat(padding);
    const valid = {
      ...pack,
      stickers: [{ ...pack.stickers[0], data: padded }],
    };
    assert.deepEqual(
      parseBackup(serializeBackup([valid])),
      parseBackup(rawBackup([valid])),
    );
  }
  const invalidData = [
    data.slice(1),
    "A" + data.slice(1),
    data.slice(0, 20) + "=" + data.slice(21),
    data.slice(0, 20) + "_" + data.slice(21),
    data.slice(0, 20) + "\n" + data.slice(21),
    "UklGR" + "A".repeat(136535),
  ];
  for (const invalid of invalidData) {
    const packs = [
      {
        ...pack,
        stickers: [{ ...pack.stickers[0], data: invalid }],
      },
    ];
    assert.throws(() => serializeBackup(packs));
    assert.throws(() => parseBackup(rawBackup(packs)));
  }
  const duplicateStickers = {
    ...pack,
    stickers: [pack.stickers[0], pack.stickers[0]],
  };
  const tooManyPacks = Array.from({ length: 501 }, (_, i) => ({
    ...pack,
    id: `pack-${i}`,
  }));
  for (const packs of [[duplicateStickers], tooManyPacks]) {
    assert.throws(() => serializeBackup(packs));
    assert.throws(() => parseBackup(rawBackup(packs)));
  }
});

test("backup export strips unknown fields before validation and serialization", () => {
  const extra: unknown = { ignored: true };
  const sticker = { ...original.stickers[0], extra };
  const extended = { ...original, stickers: [sticker], extra: sticker };
  // Unknown data can even contain cycles; only backup fields are serialized.
  sticker.extra = extended;
  const [restored] = parseBackup(serializeBackup([extended]));
  assert.equal("extra" in restored, false);
  assert.equal("extra" in restored.stickers[0], false);
  assert.equal(restored.stickers[0].data, sticker.data);
});

test("restore verifies content within metadata buckets and preserves ID conflict rules", () => {
  const first = {
    ...original,
    stickers: [{ ...original.stickers[0], data: "first-media" }],
  };
  const differentMedia = {
    ...first,
    stickers: [{ ...first.stickers[0], data: "other-media" }],
  };
  const occupied = {
    ...original,
    id: `${first.id}-restored-1`,
    name: "Other pack",
  };
  const duplicate = {
    ...differentMedia,
    id: "different-id",
    createdAt: "2025-01-01T00:00:00Z",
    stickers: [
      { ...differentMedia.stickers[0], id: "other-sticker", bytes: 0 },
    ],
  };
  const result = mergeBackup([first, occupied], [differentMedia, duplicate]);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.packs[2].id, `${first.id}-restored-2`);
  assert.equal(result.packs[2].stickers[0].data, "other-media");
  assert.equal(result.packs[0], first);
});
