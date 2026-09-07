import type { DataflowStore } from './store';
import type { AuthorScriptReply } from './author-script-contract';
import { scalarMatches, type Scalar } from '@/lib/story/dataflow';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown): value is Scalar => value === null
  || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 65536)
  || (typeof value === 'number' && Number.isFinite(value));

/** Validate untrusted messages against the current document declarations, not a caller's target. */
export function createAuthorScriptBridge(store: DataflowStore): {
  request(message: unknown): Promise<AuthorScriptReply>;
  dispose(): void;
} {
  let disposed = false;
  let lastId = 0;
  let interval = Date.now();
  let requests = 0;
  const validValue = (name: string, value: unknown): value is Scalar => {
    const decl = store.flow.values.find(v => v.kind === 'scalar' && v.name === name);
    return !!decl && decl.kind === 'scalar' && scalar(value) && scalarMatches(value, decl.type);
  };
  return {
    dispose: () => { disposed = true; },
    async request(message) {
      const id = record(message) && Number.isSafeInteger(message.id) && Number(message.id) > 0 ? Number(message.id) : 0;
      const refused = (error: string): AuthorScriptReply => ({ id, ok: false, error });
      if (disposed) return refused('Script session closed');
      if (!id || !record(message) || id <= lastId) return refused('Invalid script request');
      lastId = id;
      const now = Date.now();
      if (now - interval >= 1000) { interval = now; requests = 0; }
      if (++requests > 120) return refused('Script request limit exceeded');
      try {
        switch (message.op) {
          case 'set':
            if (typeof message.name !== 'string' || !validValue(message.name, message.value)) return refused('Invalid declared signal');
            store.setValue(message.name, message.value);
            break;
          case 'refresh': {
            const names = message.names;
            if (names !== undefined && (!Array.isArray(names) || names.length > 256
              || !names.every(n => typeof n === 'string' && store.flow.queries.some(q => q.name === n)))) return refused('Invalid declared query');
            store.refresh(names as string[] | undefined);
            break;
          }
          case 'mutate': {
            const name = message.name;
            if (typeof name !== 'string' || !store.flow.mutations?.some(m => m.name === name)) return refused('Invalid declared mutation');
            const values = message.values;
            if (values !== undefined && (!record(values) || Object.keys(values).length > 256
              || !Object.entries(values).every(([n, v]) => validValue(n, v)))) return refused('Invalid mutation values');
            // The store and server retain their independent, current permission checks.
            await store.mutate(name, values as Record<string, Scalar> | undefined);
            break;
          }
          default: return refused('Unsupported script operation');
        }
        return { id, ok: true };
      } catch {
        // Do not expose transport response bodies or arbitrary exception payloads.
        return refused('Script operation failed or permission denied');
      }
    },
  };
}
