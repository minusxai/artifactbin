import { createLocalStore } from './apollo/local-store';
import type { StoreReceipt } from './apollo/apollo-contracts';
import { entryDocument, isNewerRevision, overridesOf, parseEntry, storedOverrides, type OverrideEntry } from './viewer-overrides';
import type { ViewerStateOptions, ViewerStatePort } from './viewer-state-contract';

/** What a write from an instance of an older page revision gets: the newer revision's saved state is not its to change. */
const STALE_REVISION = 'This page was updated in another tab; reload it to save changes';

/**
 * One browser's private document. The only persistence port is that browser's storage, which holds only the viewer's
 * overrides of the page's defaults (./viewer-overrides). Reads (and so every storage notification) never write. Writes compare-and-swap against the merged document and store the overrides it leaves.
 * An instance whose page revision is older than the entry's never writes: its writes are rejected (`state.setState`
 * reports and shows the saved document again; `updateQuery` rejects) until the viewer reloads it.
 */
export function createViewerState(options: ViewerStateOptions): ViewerStatePort {
  const defaults = createLocalStore(options.defaults ?? {}).read();
  const version = options.version ?? null, revision = options.revision ?? null;
  /** The entry when browser storage is unusable (denied, full or unreadable): this viewer continues privately in memory. */
  let memory: OverrideEntry | null = null;
  let storageEnabled = true;
  const listeners = new Set<Parameters<ViewerStatePort['subscribe']>[0]>();
  let queue = Promise.resolve();
  /** An `#af-state` seed this instance shows until its persistence (under the page lock) has run. */
  let seeding: OverrideEntry | null = null;
  /** The current stored overrides entry. Never writes. */
  const stored = (): OverrideEntry | null => {
    if (!storageEnabled) return memory;
    try {
      const raw = options.storage.read();
      // Any present value, even an empty string, is this viewer's entry: an invalid one is never overwritten.
      return raw !== null ? parseEntry(raw) : null;
    } catch { storageEnabled = false; return memory; /* invalid or unavailable storage: never overwritten, memory from here */ }
  };
  const save = (next: OverrideEntry) => {
    memory = next;
    if (!storageEnabled) return;
    try { options.storage.write(JSON.stringify(storedOverrides(next))); } catch { storageEnabled = false; /* storage-denied viewers continue privately in memory */ }
  };
  const entry = () => seeding ?? stored();
  const fenced = (current: OverrideEntry | null) => !!current && isNewerRevision(current.revision, revision);
  const read = () => entryDocument(entry(), defaults, version);
  const notify = () => {
    const current = read();
    for (const listener of [...listeners]) try { listener(createLocalStore(current).read()); } catch { /* subscriptions are independent */ }
  };
  const stop = options.observe(notify);
  const serial = (work: () => Promise<StoreReceipt>) => {
    const next = queue.then(work);
    queue = next.then(() => {}, () => {});
    return next;
  };
  const locked = (work: () => Promise<StoreReceipt>) => {
    if (!options.lock) return serial(work);
    let started = false;
    return options.lock(() => { started = true; return work(); }).catch((error: unknown) => { if (started) throw error; return serial(work); });
  };
  if (options.seed) {
    // An explicit link replaces this viewer's overrides, as any write does: under the page lock, behind the revision fence.
    // Until that runs, this instance shows the seed.
    const seeded = seeding = { version, revision, overrides: overridesOf(createLocalStore(options.seed).read(), defaults) };
    void locked(async () => {
      if (fenced(stored())) { storageEnabled = false; memory = seeded; } else save(seeded);
      seeding = null;
      notify();
      return { status: 'committed', document: read() };
    }).catch(() => { seeding = null; });
  }
  return {
    read,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    write(change) {
      return locked(async () => {
        const before = entry();
        const current = entryDocument(before, defaults, version);
        if (fenced(before)) return { status: 'rejected', document: current, error: STALE_REVISION };
        const receipt = await createLocalStore(current).write(change);
        if (receipt.status !== 'committed') return receipt;
        // Checked again right before saving (nothing awaits in between): a newer revision that wrote meanwhile, past a
        // lock that did not hold, is still never overwritten.
        const latest = stored();
        if (fenced(latest)) return { status: 'rejected', document: entryDocument(latest, defaults, version), error: STALE_REVISION };
        // Another state version's overrides are not carried: `current` was the defaults, so this write resets them.
        const next = { version, revision, overrides: overridesOf(receipt.document, defaults) };
        save(next);
        notify();
        return { status: 'committed', document: entryDocument(next, defaults, version) };
      });
    },
    dispose() { stop(); listeners.clear(); },
  };
}
