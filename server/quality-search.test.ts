import assert from "node:assert/strict";
import test from "node:test";
import { findFittingQuality } from "./quality-search";

test("a fitting maximum quality needs one encode", async () => {
  const qualities: number[] = [];
  const selected = await findFittingQuality(async (quality) => {
    qualities.push(quality);
    return { value: quality, fits: true, bytes: 80 };
  }, 100);
  assert.equal(selected?.quality, 100);
  assert.deepEqual(qualities, [100]);
});

test("quality search uses measured size, keeps a valid result and bounds work", async () => {
  const qualities: number[] = [];
  const selected = await findFittingQuality(async (quality) => {
    qualities.push(quality);
    const bytes = Math.round(500 / Math.sqrt(101 - quality));
    return { value: bytes, fits: bytes <= 100, bytes };
  }, 100);
  assert.ok(selected);
  assert.ok(selected.value <= 100);
  assert.ok(selected.quality >= 74, "fits near the highest valid quality 76");
  assert.ok(qualities.length <= 6);
  assert.equal(new Set(qualities).size, qualities.length);
});

test("a failed low quality still probes interior qualities before fallback", async () => {
  const qualities: number[] = [];
  const selected = await findFittingQuality(async (quality) => {
    qualities.push(quality);
    const bytes = quality === 65 ? 99 : 120;
    return { value: quality, fits: bytes <= 100, bytes };
  }, 100);
  assert.equal(selected?.value, 65);
  assert.ok(qualities.includes(30));
  assert.ok(qualities.length <= 6);
});

test("all-miss search has a fixed four-encode budget", async () => {
  let calls = 0;
  const selected = await findFittingQuality(async () => {
    calls++;
    return { value: "oversized", fits: false, bytes: 200 };
  }, 100);
  assert.equal(selected, undefined);
  assert.equal(calls, 4);
});
