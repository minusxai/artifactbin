import type { MxError, MxSnapshot, MxReadOptions, Scalar } from '@artifactbin/contracts';
import type { DataflowStore } from './store';
import { createMx } from './mx';

export type AuthorScriptReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: MxError; snapshot?: MxSnapshot };
export interface AuthorSignalPacket { type: 'signals'; updates: Array<{ subscription: number; snapshot: MxSnapshot }> }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A bounded transport adapter. All data semantics and validation belong to mx. */
export function createAuthorScriptBridge(store: DataflowStore, send?: (packet: AuthorSignalPacket) => void) {
  let disposed = false;
  let lastId = 0;
  let interval = Date.now();
  let requests = 0;
  let awaiting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subscriptions = new Map<number, () => void>();
  const pending = new Map<number, MxSnapshot>();
  const flush = () => {
    timer = undefined;
    if (disposed || awaiting || !pending.size || !send) return;
    const updates = [...pending].map(([subscription, snapshot]) => ({ subscription, snapshot }));
    pending.clear(); awaiting = true;
    send({ type: 'signals', updates });
  };
  const schedule = () => { if (!disposed && !awaiting && timer === undefined) timer = setTimeout(flush, 16); };
  return {
    acknowledge() { if (awaiting) { awaiting = false; schedule(); } },
    dispose() {
      disposed = true; clearTimeout(timer);
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear(); pending.clear();
    },
    async request(message: unknown): Promise<AuthorScriptReply> {
      const id = record(message) && Number.isSafeInteger(message.id) && Number(message.id) > 0 ? Number(message.id) : 0;
      const refused = (code: string, text: string): AuthorScriptReply => ({ id, ok: false, error: { code, message: text } });
      if (disposed) return refused('STALE_INSTANCE', 'Script session closed');
      if (!id || !record(message) || id <= lastId) return refused('INVALID_REQUEST', 'Invalid script request');
      lastId = id;
      const now = Date.now();
      if (now - interval >= 1000) { interval = now; requests = 0; }
      if (++requests > 120) return refused('RATE_LIMIT', 'Script request limit exceeded');
      try {
        const mx = createMx(store);
        let value: unknown;
        switch (message.op) {
          case 'describe': value = await mx.describe(); break;
          case 'read': value = await mx.read(message.names as string[], message.options as MxReadOptions | undefined); break;
          case 'set': value = await mx.set(message.values as Record<string, Scalar>); break;
          case 'mutate': value = await mx.mutate(message.name as string, message.args as Record<string, Scalar> | undefined); break;
          case 'subscribe': {
            if (!send || subscriptions.size >= 128) return refused('SUBSCRIPTION_LIMIT', 'Subscription limit exceeded');
            const subscription = id;
            const stop = mx.subscribe(message.names as string[], snapshot => { pending.set(subscription, snapshot); schedule(); });
            subscriptions.set(subscription, stop);
            value = { subscription };
            break;
          }
          case 'unsubscribe': {
            if (!Number.isSafeInteger(message.subscription)) return refused('INVALID_REQUEST', 'Invalid subscription');
            const subscription = Number(message.subscription);
            subscriptions.get(subscription)?.(); subscriptions.delete(subscription); pending.delete(subscription);
            value = null; break;
          }
          default: return refused('INVALID_REQUEST', 'Unsupported script operation');
        }
        return { id, ok: true, value };
      } catch (error) {
        const details = error as Error & { code?: string; snapshot?: MxSnapshot };
        return { id, ok: false, error: { code: details.code ?? 'OPERATION_FAILED', message: String(details.message ?? 'Script operation failed').slice(0, 1000) },
          ...(details.snapshot ? { snapshot: details.snapshot } : {}) };
      }
    },
  };
}
