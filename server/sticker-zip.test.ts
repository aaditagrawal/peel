import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { isZip, MAX_ZIP_BYTES, readStickerZip } from "../src/sticker-zip";

const image = (value: string) => strToU8(value);

test("sticker bundles prefer individual images, deduplicate exports, and sort naturally", () => {
  const files: Record<string, Uint8Array> = {
    "dots_reaction_pack/README.md": image("24 individual stickers"),
    "dots_reaction_pack/dots-reactions-sheet-1.png": image("contact sheet"),
    "dots_reaction_pack/dots-reactions-sheet-2.png": image("another sheet"),
  };
  // Deliberately use the unsorted layout and duplicate sheet exports in the supplied ZIP.
  for (let i = 24; i > 0; i--) {
    files[
      `dots_reaction_pack/stickers/${String(i).padStart(2, "0")}-reaction.png`
    ] = image(`sticker ${i}`);
    if (i > 12)
      files[`dots_reaction_pack/stickers/sheet2-${i - 13}.png`] = image(
        `sticker ${i}`,
      );
  }
  for (const level of [0, 6] as const) {
    const result = readStickerZip(
      zipSync(files, { level }),
      "dots-reaction-sticker-pack.zip",
    );
    assert.equal(result.name, "Dots Reaction Sticker Pack");
    assert.equal(result.duplicates, 12);
    assert.deepEqual(
      result.images.map((entry) => entry.name),
      Array.from(
        { length: 24 },
        (_, i) => `${String(i + 1).padStart(2, "0")}-reaction.png`,
      ),
    );
    assert.ok(result.images.every((entry) => entry.mimeType === "image/png"));
  }
});

test("flat and nested ZIPs accept supported formats and skip hidden or unsafe entries", () => {
  const result = readStickerZip(
    zipSync({
      "2-wave.PNG": image("png"),
      "10-dance.GIF": image("gif"),
      "nested/hello.webp": image("webp"),
      "nested/café.jpg": image("jpg"),
      "photo.jpeg": image("jpeg"),
      "image.heic": image("heic"),
      "image.heif": image("heif"),
      "image.avif": image("avif"),
      "__MACOSX/._hello.png": image("mac"),
      ".hidden/a.png": image("hidden"),
      "../escape.png": image("traversal"),
      "nested/../escape.png": image("traversal2"),
      "nested\\..\\escape.png": image("traversal3"),
      "/absolute.png": image("absolute"),
      "C:\\drive.png": image("drive"),
      "bad\0path.png": image("null"),
      "README.md": image("instructions"),
      "movie.mp4": image("video"),
      "notes.constructor": image("not an image"),
      "notes.__proto__": image("not an image either"),
      "nested/": new Uint8Array(),
    }),
    "my_favourites.ZIP",
  );
  assert.equal(result.images.length, 8);
  assert.deepEqual(
    result.images.slice(0, 2).map((entry) => entry.name),
    ["2-wave.PNG", "10-dance.GIF"],
  );
  assert.equal(result.name, "My Favourites");
  assert.ok(
    result.images.some(
      (entry) => entry.name === "café.jpg" && entry.mimeType === "image/jpeg",
    ),
  );
  assert.ok(
    result.images.some(
      (entry) =>
        entry.name === "10-dance.GIF" && entry.mimeType === "image/gif",
    ),
  );
});

test("same names with different contents survive and byte-identical exports are skipped", () => {
  const result = readStickerZip(
    zipSync({
      "a/hello.png": image("one"),
      "b/hello.png": image("two"),
      "c/hello.png": image("one"),
    }),
    "hello.zip",
  );
  assert.deepEqual(
    result.images.map((entry) => entry.path),
    ["a/hello.png", "b/hello.png"],
  );
  assert.equal(result.duplicates, 1);
});

test("ZIP detection uses the name or MIME type, including generic file providers", () => {
  assert.ok(isZip({ name: "pack.ZIP", mimeType: "application/octet-stream" }));
  assert.ok(isZip({ name: "download", mimeType: "application/zip" }));
  assert.ok(
    isZip({ name: "download", mimeType: "application/x-zip-compressed" }),
  );
  assert.ok(!isZip({ name: "hello.png", mimeType: "image/png" }));
});

test("empty, non-image, malformed, and truncated ZIPs fail with actionable errors", () => {
  for (const bytes of [
    new Uint8Array(),
    image("not a zip"),
    new Uint8Array(100),
  ])
    assert.throws(
      () => readStickerZip(bytes, "broken.zip"),
      /This ZIP couldn't be opened/,
    );
  assert.throws(
    () => readStickerZip(zipSync({}), "empty.zip"),
    /no supported sticker images/,
  );
  assert.throws(
    () => readStickerZip(zipSync({ "notes.txt": image("notes") }), "notes.zip"),
    /no supported sticker images/,
  );
  const complete = zipSync({ "hi.png": image("hello") });
  assert.throws(
    () => readStickerZip(complete.subarray(0, complete.length - 10), "cut.zip"),
    /couldn't be opened/,
  );
});

test("archive and image count limits are enforced before inflating", () => {
  assert.throws(
    () => readStickerZip(new Uint8Array(MAX_ZIP_BYTES + 1), "large.zip"),
    /100 MB/,
  );
  const files = Object.fromEntries(
    Array.from({ length: 501 }, (_, i) => [`${i}.png`, image(String(i))]),
  );
  assert.throws(
    () => readStickerZip(zipSync(files), "many.zip"),
    /more than 500 images/,
  );
  const entries = Object.fromEntries(
    Array.from({ length: 2001 }, (_, i) => [`${i}.txt`, new Uint8Array()]),
  );
  assert.throws(
    () => readStickerZip(zipSync(entries), "many-files.zip"),
    /too many files/,
  );
});

test("declared expansion and individual image size are bounded before extraction", () => {
  function withDeclaredSize(size: number) {
    const bytes = zipSync({ "large.png": image("tiny compressed content") });
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 4; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, size, true);
        return bytes;
      }
    throw new Error("Missing central directory");
  }
  assert.throws(
    () => readStickerZip(withDeclaredSize(201 * 1024 * 1024), "bomb.zip"),
    /200 MB/,
  );
  assert.throws(
    () => readStickerZip(withDeclaredSize(51 * 1024 * 1024), "large-image.zip"),
    /50 MB/,
  );
});
