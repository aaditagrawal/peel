import assert from "node:assert/strict";
import test from "node:test";
import { combinePacks, planCombination } from "../src/combine-packs";
import {
  createLibraryStore,
  isPack,
  type Pack,
  type Sticker,
} from "../src/library-store";

function sticker(index: number, animated = false): Sticker {
  return {
    id: `sticker-${index}`,
    name: `Sticker ${index}`,
    data: `webp-${index}`,
    tray: `png-${index}`,
    bytes: index + 100,
    animated,
  };
}
function pack(id: string, stickers: Sticker[]): Pack {
  return {
    id,
    name: id,
    color: "#F8E6C8",
    createdAt: "2026-10-29T00:00:00Z",
    animated: stickers[0]?.animated ?? false,
    stickers,
    starter: true,
  };
}
function content(stickers: Sticker[]) {
  return stickers.map(({ id: _id, ...rest }) => rest);
}

test("combines multiple packs in selection order without changing the originals", () => {
  const sources = [
    pack("second", [sticker(4), sticker(5)]),
    pack("first", [sticker(1), sticker(2), sticker(3)]),
    pack("third", [sticker(6)]),
  ];
  const before = structuredClone(sources);
  const result = combinePacks(sources, "  Favorites  ");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Favorites");
  assert.deepEqual(
    content(result[0].stickers),
    content(sources.flatMap((source) => source.stickers)),
  );
  assert.equal(result[0].starter, undefined);
  assert.ok(!sources.some((source) => source.id === result[0].id));
  result[0].stickers[0].name = "Renamed copy";
  result[0].stickers.pop();
  assert.deepEqual(sources, before);
});

test("removes exact duplicate content even when sticker ids and names differ", () => {
  const duplicate = { ...sticker(1), id: "another-id", name: "Another name" };
  const sources = [
    pack("a", [sticker(1), sticker(2)]),
    pack("b", [duplicate, sticker(3), sticker(2)]),
  ];
  const plan = planCombination(sources);
  assert.equal(plan.duplicates, 2);
  assert.equal(plan.stickers.length, 3);
  assert.equal(plan.packCount, 1);
  const [result] = combinePacks(sources, "Unique");
  assert.deepEqual(
    result.stickers.map((item) => item.name),
    ["Sticker 1", "Sticker 2", "Sticker 3"],
  );
});

test("colliding source sticker ids keep distinct content and get unique copy ids", () => {
  const sources = [
    pack("a", [sticker(1)]),
    pack("b", [{ ...sticker(2), id: "sticker-1" }]),
  ];
  const [result] = combinePacks(sources, "Collision");
  assert.equal(result.stickers.length, 2);
  assert.equal(new Set(result.stickers.map((item) => item.id)).size, 2);
  assert.ok(result.stickers.every((item) => item.id !== "sticker-1"));
});

test("ignores repeated source packs and requires two different packs", () => {
  const source = pack("a", [sticker(1)]);
  assert.equal(planCombination([source, source]).sourceCount, 1);
  assert.throws(() => combinePacks([source, source], "Name"), /at least two/);
  assert.throws(() => combinePacks([], "Name"), /at least two/);
});

test("keeps static and animated content separate with an accurate preview", () => {
  const sources = [
    pack("animated", [sticker(1, true), sticker(2, true), sticker(3, true)]),
    pack("static", [sticker(4), sticker(5), sticker(6)]),
  ];
  const plan = planCombination(sources);
  const results = combinePacks(sources, "Mixed");
  assert.equal(plan.mixed, true);
  assert.equal(plan.hasDrafts, false);
  assert.equal(plan.packCount, results.length);
  assert.deepEqual(
    results.map((result) => result.name),
    ["Mixed · Images", "Mixed · Animated"],
  );
  assert.ok(
    results.every((result) =>
      result.stickers.every((item) => item.animated === result.animated),
    ),
  );
  assert.deepEqual(
    content(results.flatMap((result) => result.stickers)),
    content([...sources[1].stickers, ...sources[0].stickers]),
  );
});

test("overflow preserves every sticker and avoids unnecessary small drafts", () => {
  for (const count of [30, 31, 32, 60, 61, 62, 91, 92]) {
    const stickers = Array.from({ length: count }, (_, index) =>
      sticker(index),
    );
    const sources: Pack[] = [];
    for (let offset = 0; offset < stickers.length; offset += 20)
      sources.push(pack(`pack-${offset}`, stickers.slice(offset, offset + 20)));
    const results = combinePacks(sources, "a".repeat(70));
    assert.equal(planCombination(sources).packCount, results.length);
    assert.ok(
      results.every(
        (result) => result.stickers.length >= 3 && result.stickers.length <= 30,
      ),
    );
    assert.ok(
      results.every((result) => result.name.length <= 70 && isPack(result)),
    );
    assert.deepEqual(
      content(results.flatMap((result) => result.stickers)),
      content(stickers),
    );
    assert.equal(
      new Set(results.map((result) => result.id)).size,
      results.length,
    );
    assert.equal(
      new Set(
        results.flatMap((result) => result.stickers.map((item) => item.id)),
      ).size,
      count,
    );
  }
});

test("short groups stay as drafts and empty or unnamed combinations are rejected", () => {
  const sources = [pack("a", [sticker(1)]), pack("b", [sticker(2, true)])];
  const plan = planCombination(sources);
  assert.equal(plan.hasDrafts, true);
  assert.equal(plan.packCount, 2);
  assert.equal(combinePacks(sources, "Drafts").length, 2);
  assert.throws(() => combinePacks(sources, "   "), /name/);
  assert.throws(
    () => combinePacks([pack("a", []), pack("b", [])], "Empty"),
    /with stickers/,
  );
});

test("combined packs survive saving and reloading alongside the originals", async () => {
  let saved: string | null = null;
  const storage = {
    read: async () => saved,
    write: async (value: string) => {
      saved = value;
    },
  };
  const sources = [
    pack("a", [sticker(1), sticker(2)]),
    pack("b", [sticker(3)]),
  ];
  const store = createLibraryStore(storage, sources);
  await store.load();
  const combined = combinePacks(store.getSnapshot().packs, "Saved combo");
  store.persist([...combined, ...store.getSnapshot().packs]);
  await store.save();
  assert.equal(store.getSnapshot().dirty, false);
  const reloaded = createLibraryStore(storage, []);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().ready, true);
  assert.deepEqual(reloaded.getSnapshot().packs, [...combined, ...sources]);
});
