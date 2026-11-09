import { makePacks } from "./import-packs";
import type { Pack, Sticker } from "./library-store";

export function planCombination(packs: Pack[]) {
  const sources = [...new Map(packs.map((pack) => [pack.id, pack])).values()];
  const seen = new Set<string>();
  const stickers: Sticker[] = [];
  let duplicates = 0;
  for (const pack of sources) {
    for (const sticker of pack.stickers) {
      if (seen.has(sticker.data)) duplicates += 1;
      else {
        seen.add(sticker.data);
        stickers.push(sticker);
      }
    }
  }
  const staticCount = stickers.filter((sticker) => !sticker.animated).length;
  const animatedCount = stickers.length - staticCount;
  return {
    sourceCount: sources.length,
    stickers,
    duplicates,
    packCount: Math.ceil(staticCount / 30) + Math.ceil(animatedCount / 30),
    mixed: staticCount > 0 && animatedCount > 0,
    hasDrafts:
      (staticCount > 0 && staticCount < 3) ||
      (animatedCount > 0 && animatedCount < 3),
  };
}

/** Copy content into new packs so edits never affect the source packs. */
export function combinePacks(packs: Pack[], name: string): Pack[] {
  const plan = planCombination(packs);
  if (plan.sourceCount < 2)
    throw Error("Choose at least two packs to combine.");
  if (!name.trim()) throw Error("Give your combined pack a name.");
  if (!plan.stickers.length) throw Error("Choose packs with stickers in them.");
  return makePacks(plan.stickers, name).map((pack) => ({
    ...pack,
    stickers: pack.stickers.map((sticker, index) => ({
      ...sticker,
      id: `${pack.id}-sticker-${index}`,
    })),
  }));
}
