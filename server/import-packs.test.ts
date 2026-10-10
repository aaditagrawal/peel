import { test } from "node:test";
import assert from "node:assert/strict";
import { makePacks, appendImported } from "../src/import-packs";
import type { Sticker } from "../src/library";
const sticker = (id: number, animated = false): Sticker => ({
  id: String(id),
  name: String(id),
  data: "data",
  tray: "tray",
  bytes: 4,
  animated,
});
test("mixed batches over 30 are split without dropping or reordering stickers", () => {
  const input = Array.from({ length: 75 }, (_, i) => sticker(i, i % 3 === 0));
  const packs = makePacks(input, "Vacation");
  assert.deepEqual(
    packs.map((p) => p.stickers.length),
    [30, 20, 25],
  );
  for (const p of packs)
    assert.ok(p.stickers.every((s) => s.animated === p.animated));
  assert.equal(new Set(packs.map((p) => p.id)).size, 3);
  for (const animated of [false, true])
    assert.deepEqual(
      packs.filter((p) => p.animated === animated).flatMap((p) => p.stickers),
      input.filter((s) => s.animated === animated),
    );
});
test("append fills available slots and saves incompatible/overflow imports in new packs", () => {
  const pack = makePacks(
    Array.from({ length: 29 }, (_, i) => sticker(i)),
    "Trip",
  )[0];
  const input = [
    sticker(30, true),
    sticker(31),
    sticker(32),
    sticker(33, true),
  ];
  const { updated, created } = appendImported(pack, input);
  assert.equal(updated.stickers.length, 30);
  assert.equal(updated.stickers[29].id, "31");
  assert.deepEqual(
    created.flatMap((p) => p.stickers.map((s) => s.id)),
    ["32", "30", "33"],
  );
  assert.equal(pack.stickers.length, 29);
});

test("large selections avoid final packs with only one or two stickers", () => {
  for (const count of [31, 32, 61, 62, 91, 92]) {
    const input = Array.from({ length: count }, (_, i) => sticker(i));
    const packs = makePacks(input, "Friends");
    assert.ok(
      packs.every((p) => p.stickers.length >= 3 && p.stickers.length <= 30),
    );
    assert.deepEqual(
      packs.flatMap((p) => p.stickers),
      input,
    );
  }
});
