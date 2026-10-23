import { createLocalStore } from './apollo/client';
import type { StoreReceipt } from './apollo/apollo-contracts';
import type { ViewerStateOptions, ViewerStatePort } from './viewer-state-contract';

/** One browser's private document. The only persistence port is that browser's storage. */
export function createViewerState(options: ViewerStateOptions): ViewerStatePort {
  let document = createLocalStore(options.initial ?? {}).read();
  const listeners = new Set<Parameters<ViewerStatePort['subscribe']>[0]>();
  let queue = Promise.resolve();
  let storageEnabled = true;
  if (options.replaceInitial) try { options.storage.write(JSON.stringify(document)); } catch { storageEnabled = false; /* memory remains available */ }
  const read = () => {
    try { const raw = storageEnabled ? options.storage.read() : null; if (raw) document = createLocalStore(JSON.parse(raw)).read(); } catch { storageEnabled = false; /* invalid or unavailable storage retains the viewer's document */ }
    return createLocalStore(document).read();
  };
  read();
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
  return {
    read,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    write(change) {
      return locked(async () => {
        const store = createLocalStore(read());
        const receipt = await store.write(change);
        if (receipt.status !== 'committed') return receipt;
        document = receipt.document;
        try { options.storage.write(JSON.stringify(document)); } catch { storageEnabled = false; /* storage-denied viewers continue privately in memory */ }
        notify();
        return receipt;
      });
    },
    dispose() { stop(); listeners.clear(); },
  };
}
