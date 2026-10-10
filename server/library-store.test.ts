import assert from "node:assert/strict";
import test from "node:test";
import { createLibraryStore, type Pack } from "../src/library-store";

const pack: Pack = {
  id: "my-pack",
  name: "My pack",
  color: "#ffffff",
  animated: false,
  createdAt: "2026-10-08T00:00:00Z",
  stickers: [],
};
function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("an unread library cannot be overwritten by starter packs; retry recovers it", async () => {
  let unavailable = true;
  const writes: string[] = [];
  const store = createLibraryStore(
    {
      read: async () => {
        if (unavailable) throw Error("disk");
        return JSON.stringify([pack]);
      },
      write: async (value) => {
        writes.push(value);
      },
    },
    [],
  );
  await store.load();
  assert.equal(store.getSnapshot().ready, false);
  store.persist([]);
  await store.save();
  assert.equal(writes.length, 0);
  unavailable = false;
  await store.load();
  assert.deepEqual(store.getSnapshot().packs, [pack]);
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().error, null);
});

test("failed saves retain edits and retry clears the unsaved state", async () => {
  let unavailable = true;
  let saved = "";
  const store = createLibraryStore(
    {
      read: async () => null,
      write: async (value) => {
        if (unavailable) throw Error("quota");
        saved = value;
      },
    },
    [],
  );
  await store.load();
  store.persist([pack]);
  await store.save();
  assert.deepEqual(store.getSnapshot().packs, [pack]);
  assert.equal(store.getSnapshot().dirty, true);
  assert.ok(store.getSnapshot().error);
  unavailable = false;
  await store.save();
  assert.deepEqual(JSON.parse(saved), [pack]);
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(store.getSnapshot().saving, false);
  assert.equal(store.getSnapshot().error, null);
});

test("edits during an in-flight save are written afterwards without stale errors", async () => {
  const first = deferred();
  const started = deferred();
  const writes: string[] = [];
  const store = createLibraryStore(
    {
      read: async () => null,
      write: async (value) => {
        writes.push(value);
        if (writes.length === 1) {
          started.resolve();
          await first.promise;
        }
      },
    },
    [],
  );
  await store.load();
  store.persist([pack]);
  await started.promise;
  const edited = { ...pack, name: "Renamed" };
  store.persist([edited]);
  first.reject(Error("temporary failure"));
  await store.save();
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[1]), [edited]);
  assert.deepEqual(store.getSnapshot().packs, [edited]);
  assert.equal(store.getSnapshot().dirty, false);
  assert.equal(store.getSnapshot().error, null);
});

test("malformed saved records block writes instead of replacing user data", async () => {
  for (const raw of ["{", "[null]", '[{"id":"broken"}]']) {
    let written = false;
    const store = createLibraryStore(
      {
        read: async () => raw,
        write: async () => {
          written = true;
        },
      },
      [pack],
    );
    await store.load();
    store.persist([]);
    await store.save();
    assert.equal(store.getSnapshot().ready, false);
    assert.equal(written, false);
  }
});

test("an empty saved library stays empty instead of restoring starter packs", async () => {
  const store = createLibraryStore(
    { read: async () => "[]", write: async () => {} },
    [pack],
  );
  await store.load();
  assert.deepEqual(store.getSnapshot().packs, []);
});
