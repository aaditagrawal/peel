import type { Pack, Sticker } from "./library";

/** Route every converted sticker into a valid pack, preserving selection order. */
export function makePacks(stickers: Sticker[], name: string): Pack[] {
  const kinds = [false, true].filter((kind) =>
    stickers.some((s) => s.animated === kind),
  );
  return kinds.flatMap((animated) => {
    const matching = stickers.filter((s) => s.animated === animated);
    const packs: Pack[] = [];
    for (let offset = 0; offset < matching.length;) {
      const remaining = matching.length - offset;
      const count =
        remaining > 30 && remaining < 33
          ? remaining - 3
          : Math.min(30, remaining);
      const suffix =
        kinds.length > 1 ? (animated ? " · Animated" : " · Images") : "";
      const number = matching.length > 30 ? ` · ${packs.length + 1}` : "";
      packs.push({
        id: `peel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        name:
          (name.trim() || "My sticker pack").slice(
            0,
            70 - suffix.length - number.length,
          ) +
          suffix +
          number,
        animated,
        stickers: matching.slice(offset, offset + count),
        createdAt: new Date().toISOString(),
        color: animated ? "#E7EACC" : "#F8E6C8",
      });
      offset += count;
    }
    return packs;
  });
}

export function appendImported(pack: Pack, stickers: Sticker[]) {
  const added: Sticker[] = [];
  const extra: Sticker[] = [];
  for (const sticker of stickers) {
    if (
      sticker.animated === pack.animated &&
      pack.stickers.length + added.length < 30
    )
      added.push(sticker);
    else extra.push(sticker);
  }
  return {
    updated: { ...pack, stickers: [...pack.stickers, ...added] },
    created: makePacks(extra, `${pack.name.slice(0, 40)} · More`),
  };
}
