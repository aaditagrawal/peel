import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import type { DocumentPickerAsset } from "expo-document-picker";
import { importFiles } from "../src/file-import";
import type { Sticker } from "../src/library-store";

const asset = (name: string): DocumentPickerAsset => ({
  name,
  uri: `file:///${name}`,
  lastModified: 0,
});
const sticker = (item: DocumentPickerAsset): Sticker => ({
  id: item.name,
  name: item.name,
  data: "webp",
  tray: "tray",
  animated: /\.gif$/i.test(item.name),
  bytes: 4,
});
const archive = zipSync({
  "stickers/01.png": strToU8("first"),
  "stickers/02.gif": strToU8("second"),
  "stickers/03.png": strToU8("third"),
});

test("mixed image and ZIP imports preserve successful conversions; retries only repeat failures", async () => {
  const calls: string[] = [];
  const released: string[] = [];
  let fail = true;
  const io: Parameters<typeof importFiles>[1] = {
    readArchive: async () => archive,
    withImage: async (image, use) => {
      try {
        return await use({
          ...asset(image.name),
          mimeType: image.mimeType,
          size: image.data.length,
        });
      } finally {
        released.push(image.name);
      }
    },
    convert: async (item) => {
      calls.push(item.name);
      if (fail && (item.name === "02.gif" || item.name === "photo.jpg"))
        throw new Error("Could not decode this image.");
      return sticker(item);
    },
  };
  const sources = [
    { asset: asset("my-pack.zip") },
    { asset: asset("photo.jpg") },
  ];
  const progress: string[] = [];
  const first = await importFiles(sources, io, (stage) => progress.push(stage));
  assert.deepEqual(
    first.stickers.map((s) => s.name),
    ["01.png", "03.png"],
  );
  assert.deepEqual(first.failedSources, [
    { asset: sources[0].asset, entries: ["stickers/02.gif"] },
    { asset: sources[1].asset },
  ]);
  assert.ok(
    first.failures[0].includes("my-pack.zip / 02.gif: Could not decode"),
  );
  assert.deepEqual(released, ["01.png", "02.gif", "03.png"]);
  assert.ok(progress.some((stage) => stage.includes("2/3 · 02.gif")));
  fail = false;
  calls.length = 0;
  const retry = await importFiles(first.failedSources, io, () => {});
  assert.deepEqual(calls, ["02.gif", "photo.jpg"]);
  assert.equal(retry.failedSources.length, 0);
  assert.deepEqual(
    retry.stickers.map((s) => s.animated),
    [true, false],
  );
});

test("broken or unreadable archives do not discard other imports", async () => {
  const good = asset("photo.png");
  const bad = asset("broken.zip");
  const result = await importFiles(
    [{ asset: bad }, { asset: good }],
    {
      readArchive: async () => strToU8("broken"),
      withImage: async () => {
        throw new Error("should not extract");
      },
      convert: async (item) => sticker(item),
    },
    () => {},
  );
  assert.deepEqual(result.stickers, [sticker(good)]);
  assert.deepEqual(result.failedSources, [{ asset: bad, entries: undefined }]);
  assert.match(result.failures[0], /This ZIP couldn't be opened/);
});

test("oversized ZIPs fail before reading their bytes", async () => {
  const result = await importFiles(
    [{ asset: { ...asset("large.zip"), size: 101 * 1024 * 1024 } }],
    {
      readArchive: async () => {
        throw new Error("should not read");
      },
      withImage: async () => {
        throw new Error("should not extract");
      },
      convert: async (item) => sticker(item),
    },
    () => {},
  );
  assert.match(result.failures[0], /Choose a ZIP smaller than 100 MB/);
});

test("a retry reports removed ZIP entries instead of silently losing them", async () => {
  const result = await importFiles(
    [{ asset: asset("changed.zip"), entries: ["stickers/missing.png"] }],
    {
      readArchive: async () => archive,
      withImage: async () => {
        throw new Error("should not extract");
      },
      convert: async (item) => sticker(item),
    },
    () => {},
  );
  assert.equal(result.stickers.length, 0);
  assert.equal(result.failedSources.length, 1);
  assert.match(result.failures[0], /This ZIP has changed/);
});
