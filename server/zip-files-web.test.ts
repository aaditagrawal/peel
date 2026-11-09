import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { readArchive, withImage } from "../src/zip-files.web";
import type { Sticker } from "../src/library-store";

test("web extraction preserves binary bytes and releases each object URL on success or failure", async () => {
  const image = {
    path: "stickers/hi.png",
    name: "hi.png",
    mimeType: "image/png",
    data: new Uint8Array([0, 255, 128, 1]),
  };
  let uri = "";
  const sticker: Sticker = {
    id: "hi",
    name: "hi.png",
    data: "webp",
    tray: "tray",
    animated: false,
    bytes: 4,
  };
  const result = await withImage(image, async (asset) => {
    uri = asset.uri;
    assert.equal(asset.mimeType, "image/png");
    assert.equal(asset.size, 4);
    assert.equal(asset.name, "hi.png");
    assert.deepEqual(
      new Uint8Array(await asset.file!.arrayBuffer()),
      image.data,
    );
    assert.deepEqual(
      new Uint8Array(await (await fetch(uri)).arrayBuffer()),
      image.data,
    );
    return sticker;
  });
  assert.equal(result, sticker);
  await assert.rejects(fetch(uri));
  await assert.rejects(
    withImage(image, async (asset) => {
      uri = asset.uri;
      throw new Error("Could not convert");
    }),
    /Could not convert/,
  );
  await assert.rejects(fetch(uri));
});

test("web ZIP reads use the picker File and preserve binary data", async () => {
  const data = strToU8("archive contents");
  const file = new File([data], "pack.zip", { type: "application/zip" });
  assert.deepEqual(
    await readArchive({
      name: file.name,
      file,
      uri: "unused",
      lastModified: 0,
    }),
    data,
  );
});
