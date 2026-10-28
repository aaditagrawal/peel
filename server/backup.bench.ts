// Run with: node --expose-gc --import tsx server/backup.bench.ts
// Measures JS allocation and CPU on this machine, not mobile frame latency.
import { performance } from "node:perf_hooks";
import { mergeBackup, serializeBackup } from "../src/backup-format";
import type { Pack } from "../src/library-store";

const packs: Pack[] = Array.from({ length: 100 }, (_, p) => ({
  id: `pack-${p}`,
  name: `Pack ${p}`,
  color: "#ffffff",
  animated: false,
  createdAt: "2026-10-08T00:00:00Z",
  stickers: Array.from({ length: 10 }, (_, s) => ({
    id: `sticker-${s}`,
    name: `Sticker ${s}`,
    data: "UklGR" + "A".repeat(65531),
    tray: "iVBORw0KGgo" + "A".repeat(1013),
    animated: false,
    bytes: 49152,
  })),
}));

const serializeMs: number[] = [];
const heapDeltaMiB: number[] = [];
let backupBytes = 0;
for (let i = 0; i < 5; i++) {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = serializeBackup(packs);
  serializeMs.push(performance.now() - start);
  backupBytes = result.length;
  heapDeltaMiB.push((process.memoryUsage().heapUsed - before) / 1024 / 1024);
}

let nameReads = 0;
const mergePacks = (prefix: string) =>
  Array.from({ length: 500 }, (_, i): Pack => ({
    ...packs[0],
    id: `${prefix}-${i}`,
    get name() {
      nameReads++;
      return `${prefix} ${i}`;
    },
  }));
const existing = mergePacks("existing");
const incoming = mergePacks("incoming");
const mergeStart = performance.now();
const merged = mergeBackup(existing, incoming);
const mergeMs = performance.now() - mergeStart;

console.log(
  JSON.stringify(
    {
      backupBytes,
      serializeMs: serializeMs.map((ms) => +ms.toFixed(1)),
      heapDeltaMiB: heapDeltaMiB.map((mib) => +mib.toFixed(1)),
      mergeMs: +mergeMs.toFixed(2),
      mergeNameReads: nameReads,
      mergedPacks: merged.packs.length,
      maxRSSMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    },
    null,
    2,
  ),
);
