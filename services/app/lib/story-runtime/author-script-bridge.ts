import type { DataflowStore } from './store';
import { scalarMatches, type Scalar } from '@/lib/story/dataflow';

export type AuthorScriptReply = { id: number; ok: true } | { id: number; ok: false; error: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown): value is Scalar => value === null || typeof value === 'boolean'
  || (typeof value === 'string' && value.length <= 65536)
  || (typeof value === 'number' && Number.isFinite(value));

/** The sole host capability exposed to untrusted author code. */
export function createAuthorScriptBridge(store: DataflowStore): { request(message: unknown): Promise<AuthorScriptReply>; dispose(): void } {
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
          case 'refresh':
            if (message.names !== undefined && (!Array.isArray(message.names) || message.names.length > 256
              || !message.names.every(n => typeof n === 'string' && store.flow.queries.some(q => q.name === n)))) return refused('Invalid declared query');
            store.refresh(message.names as string[] | undefined);
            break;
          case 'mutate': {
            if (typeof message.name !== 'string' || !store.flow.mutations?.some(m => m.name === message.name)) return refused('Invalid declared mutation');
            if (message.values !== undefined && (!record(message.values) || Object.keys(message.values).length > 256
              || !Object.entries(message.values).every(([name, value]) => validValue(name, value)))) return refused('Invalid mutation values');
            await store.mutate(message.name, message.values as Record<string, Scalar> | undefined);
            break;
          }
          default: return refused('Unsupported script operation');
        }
        return { id, ok: true };
      } catch { return refused('Script operation failed or permission denied'); }
    },
  };
}
