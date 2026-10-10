import test from "node:test";
import assert from "node:assert/strict";
import starterPacks from "../src/starter-packs.json";
import {
  mergeBackup,
  parseBackup,
  serializeBackup,
} from "../src/backup-format";

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
