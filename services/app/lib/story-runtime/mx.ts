/**
 * `window.mx` — the author script's handle on the document's data.
 *
 * A Helmet `<script>` runs after hydration with plain DOM in reach; this is
 * the ONE extra thing it gets: the same store the bound controls and embeds
 * use (lib/story-runtime/store.ts), so a script can read a value, set one
 * (every dependent query re-runs and every bound embed re-renders), and
 * subscribe to changes, and run a declared `<Mutation>` — a custom widget, a
 * calculator, a "reset filters" button, a row the reader adds — without ever
 * touching React. Deliberately tiny: four verbs and a refresh, plain values
 * in and out. React-free, like the store.
 *
 * Installed by the runtime entry BEFORE `mx:ready` fires and before the parked
 * author script is re-injected, so `mx` is defined from the script's first
 * line (see lib/story-runtime/entry.tsx).
 */
import type { DataflowState, Scalar, TableResult } from '@/lib/story/dataflow';
import type { DataflowStore } from './store';

export interface MxApi {
  params: {
    get(name: string): Scalar;
    set(name: string, value: Scalar): void;
    /** Called with the full values map after every change; returns unsubscribe. */
    subscribe(listener: (values: Record<string, Scalar>) => void): () => void;
  };
  data: {
    get(name: string): TableResult | undefined;
    /** The queries a re-run has in flight right now (their previous rows stay in `get` meanwhile). */
    pending(): string[];
    /** Called with the full state (and the pending names) after every change; returns unsubscribe. */
    subscribe(listener: (state: DataflowState, pending: string[]) => void): () => void;
  };
  /** Re-run every query (or the named ones) with the current values. */
  refresh(names?: string[]): void;
  /**
   * Perform a `<Mutation>` the document declares, with the current values —
   * the fourth verb, and the author's own handle on a write. Optional
   * `values` override declared ones for THIS call only (a form that posts a
   * field it did not bind to a control). Resolves once the write has landed;
   * the queries reading that dataset re-run on their own, so a script never
   * has to refresh after writing. Rejects with the server's message.
   */
  mutate(name: string, values?: Record<string, Scalar>): Promise<void>;
}

declare global {
  interface Window { mx?: MxApi }
}

export function createMx(store: DataflowStore): MxApi {
  return {
    params: {
      get: (name) => store.getValue(name),
      set: (name, value) => store.setValue(name, value),
      subscribe: (listener) => {
        let last = store.getState().values;
        return store.subscribe(() => {
          const next = store.getState().values;
          if (next === last) return;
          last = next;
          listener(next);
        });
      },
    },
    data: {
      get: (name) => store.getTable(name),
      pending: () => [...store.pending()],
      subscribe: (listener) => store.subscribe(() => listener(store.getState(), [...store.pending()])),
    },
    refresh: (names) => store.refresh(names),
    mutate: (name, values) => {
      // An override is a real value change: it belongs in the store before the
      // write reads it, and the controls bound to it must show it.
      if (values) store.setValues(values);
      return store.mutate(name);
    },
  };
}

/** Install on the window (idempotent per store). */
export function installMx(store: DataflowStore): MxApi {
  const api = createMx(store);
  if (typeof window !== 'undefined') window.mx = api;
  return api;
}
