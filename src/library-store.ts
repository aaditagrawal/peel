export type Sticker = {
  id: string;
  name: string;
  data: string;
  tray: string;
  animated: boolean;
  bytes: number;
};
export type Pack = {
  id: string;
  name: string;
  color: string;
  animated: boolean;
  createdAt: string;
  stickers: Sticker[];
  starter?: boolean;
};
export type Library = {
  packs: Pack[];
  ready: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
};
type Storage = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isSticker(value: unknown): value is Sticker {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.data === "string" &&
    typeof value.tray === "string" &&
    typeof value.animated === "boolean" &&
    typeof value.bytes === "number" &&
    Number.isFinite(value.bytes) &&
    value.bytes >= 0
  );
}
export function isPack(value: unknown): value is Pack {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.color === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.animated === "boolean" &&
    Array.isArray(value.stickers) &&
    value.stickers.length <= 30 &&
    value.stickers.every(isSticker)
  );
}

// Storage is injected so failed reads, full disks and overlapping saves can be tested.
export function createLibraryStore(storage: Storage, initialPacks: Pack[]) {
  let state: Library = {
    packs: initialPacks,
    ready: false,
    error: null,
    dirty: false,
    saving: false,
  };
  const listeners = new Set<() => void>();
  let revision = 0;
  let savedRevision = 0;
  let saving: Promise<void> | null = null;
  let loading: Promise<void> | null = null;
  function emit(next: Library) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function load(): Promise<void> {
    if (state.ready) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      await Promise.resolve();
      try {
        const raw = await storage.read();
        const parsed: unknown = raw === null ? initialPacks : JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.every(isPack)) {
          throw new Error("Invalid library");
        }
        emit({ ...state, packs: parsed, ready: true, error: null });
      } catch {
        // Never allow starter packs to replace an unread saved library.
        emit({
          ...state,
          error:
            "Your saved packs couldn't be opened. Try again. Your files haven't been changed.",
        });
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  function save(): Promise<void> {
    if (!state.ready || !state.dirty) return Promise.resolve();
    if (saving) return saving;
    saving = (async () => {
      await Promise.resolve();
      emit({ ...state, saving: true });
      try {
        while (savedRevision < revision) {
          const currentRevision = revision;
          const packs = state.packs;
          try {
            await storage.write(JSON.stringify(packs));
            savedRevision = currentRevision;
            if (currentRevision === revision) {
              emit({ ...state, dirty: false, error: null });
            }
          } catch {
            if (currentRevision === revision) {
              emit({
                ...state,
                dirty: true,
                error:
                  "Changes aren't saved yet. Free some device storage, then retry before closing Peel.",
              });
              break;
            }
            // A newer edit may have removed large packs. Try that version next.
          }
        }
      } finally {
        saving = null;
        emit({ ...state, saving: false });
      }
    })();
    return saving;
  }
  function persist(packs: Pack[]) {
    if (!state.ready) return;
    revision += 1;
    emit({ ...state, packs, dirty: true });
    void save();
  }
  return {
    getSnapshot: () => state,
    subscribe(callback: () => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    load,
    save,
    persist,
    clearError: () => emit({ ...state, error: null }),
  };
}
