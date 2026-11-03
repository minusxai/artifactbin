/**
 * IN-FLIGHT READ SHARING: simultaneous callers asking for the same immutable read (one dataset revision, under one
 * reader's authority and role view, named by the key) join one load instead of each starting their own. Nothing
 * outlives the read: a settled one leaves the map, and an unsettled one is cancelled only when every joiner has
 * gone. Each joiner still runs its own fences. A key must name everything that decides the answer.
 */
export function createSharedReads<T>() {
  const inFlight = new Map<string, { result: Promise<T>; joined: number; controller: AbortController }>();
  return async function sharedRead(key: string, signal: AbortSignal, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let entry = inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created = { joined: 0, controller, result: Promise.resolve().then(() => load(controller.signal)) };
      entry = created;
      inFlight.set(key, created);
      created.result.then(() => {}, () => {}).finally(() => { if (inFlight.get(key) === created) inFlight.delete(key); });
    }
    const joined = entry;
    joined.joined++;
    let leave!: () => void;
    const left = new Promise<never>((_, reject) => {
      leave = () => reject(signal.reason ?? Error('cancelled'));
    });
    left.catch(() => {});
    const onAbort = () => leave();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.race([joined.result, left]);
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (--joined.joined === 0 && inFlight.get(key) === joined) {
        // Settled reads are already gone from the map; an unsettled one nobody waits on is cancelled.
        inFlight.delete(key);
        joined.controller.abort(Error('cancelled'));
      }
    }
  };
}
