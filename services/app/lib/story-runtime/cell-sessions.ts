import type { Scalar } from '../story/dataflow';

/** Immutable snapshots shared by every mounted view of a cell. */
export interface CellSession {
  readonly draft: Scalar;
  readonly original: Scalar;
  readonly row: Readonly<Record<string, Scalar>>;
  readonly phase: 'editing' | 'pending' | 'saved' | 'error';
  readonly error: string | null;
}
export interface CellSessions {
  get(key: string): CellSession | undefined;
  subscribe(listener: () => void): () => void;
  /** Reopening an existing session preserves its draft and original row snapshot. */
  begin(key: string, initial: Scalar, row: Record<string, Scalar>): void;
  change(key: string, value: Scalar): void;
  cancel(key: string): void;
  /** Errors are represented in the observable session, not thrown to event handlers. */
  commit(key: string, write: (draft: Scalar, original: Scalar, row: Readonly<Record<string, Scalar>>) => Promise<void>): Promise<void>;
  /** Remove a saved overlay only when authoritative query data catches up. */
  reconcile(key: string, authoritative: Scalar): void;
}

/** Document-local store: survives cell unmounting, without depending on React or transport. */
export function createCellSessions(): CellSessions {
  const sessions = new Map<string, CellSession>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const put = (key: string, session: CellSession) => {
    sessions.set(key, Object.freeze(session));
    notify();
  };
  const remove = (key: string) => { if (sessions.delete(key)) notify(); };
  return {
    get: (key) => sessions.get(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(key, initial, row) {
      if (sessions.has(key)) return;
      put(key, { draft: initial, original: initial, row: Object.freeze({ ...row }), phase: 'editing', error: null });
    },
    change(key, value) {
      const session = sessions.get(key);
      if (!session || session.phase === 'pending' || session.phase === 'saved') return;
      if (Object.is(session.draft, value) && session.phase === 'editing') return;
      put(key, { ...session, draft: value, phase: 'editing', error: null });
    },
    cancel: remove,
    async commit(key, write) {
      const session = sessions.get(key);
      if (!session || session.phase === 'pending' || session.phase === 'saved') return;
      if (Object.is(session.draft, session.original)) { remove(key); return; }
      const pending: CellSession = { ...session, phase: 'pending', error: null };
      put(key, pending);
      try {
        await write(pending.draft, pending.original, pending.row);
        // Cancellation or a newer session wins over a late response.
        if (sessions.get(key) === pending) put(key, { ...pending, phase: 'saved' });
      } catch (error) {
        if (sessions.get(key) === pending) {
          put(key, { ...pending, phase: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    reconcile(key, authoritative) {
      const session = sessions.get(key);
      if (session?.phase === 'saved' && Object.is(session.draft, authoritative)) remove(key);
    },
  };
}
