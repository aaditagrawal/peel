import { mergeBackup } from "./backup-format";
import { readLibrary, writeLibrary } from "./storage";
import { useSyncExternalStore } from "react";
import starterPacks from "./starter-packs.json";
import { createLibraryStore, type Pack } from "./library-store";
export type { Sticker, Pack } from "./library-store";

const store = createLibraryStore(
  { read: readLibrary, write: writeLibrary },
  starterPacks,
);
export const persist = store.persist;
export const addPacks = (packs: Pack[]) =>
  persist([...packs, ...store.getSnapshot().packs]);
export const removePack = (id: string) =>
  persist(store.getSnapshot().packs.filter((p) => p.id !== id));
export const updatePack = (pack: Pack) =>
  persist(store.getSnapshot().packs.map((p) => (p.id === pack.id ? pack : p)));
export const clearError = store.clearError;
export const retrySave = store.save;
export const retryLoad = store.load;
void store.load();
export function useLibrary() {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
export function validatePack(pack: Pack) {
  if (!pack.name.trim()) return "Give your pack a name.";
  if (pack.stickers.length < 3)
    return "WhatsApp needs at least 3 stickers in a pack.";
  if (pack.stickers.length > 30) return "A pack can hold up to 30 stickers.";
  if (pack.stickers.some((s) => s.animated !== pack.animated))
    return "Images and animations need separate packs.";
  return null;
}

export async function restorePacks(incoming: Pack[]) {
  const current = store.getSnapshot();
  if (!current.ready)
    throw new Error("Reload your library before restoring a backup.");
  const merged = mergeBackup(current.packs, incoming);
  if (merged.added) {
    store.persist(merged.packs);
    await store.save();
    if (store.getSnapshot().dirty)
      throw new Error(
        "Restored packs are in memory but couldn't be saved. Free some storage, then tap Retry save before closing Peel.",
      );
  }
  return merged;
}
