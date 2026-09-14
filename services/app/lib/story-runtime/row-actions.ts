/** Document-owned action state survives row reordering, filtering and virtualization. */
export interface RowActionState {
  readonly pending: boolean;
  readonly error: string | null;
}
export function createRowActions() {
  const states = new Map<string, RowActionState>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  return {
    get: (identity: string) => states.get(identity),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async run(identity: string, write: () => Promise<void>) {
      if (states.get(identity)?.pending) return;
      states.set(identity, {pending: true, error: null});
      notify();
      try {
        await write();
        states.delete(identity);
      } catch (error) {
        states.set(identity, {pending: false, error: error instanceof Error ? error.message : String(error)});
      }
      notify();
    },
  };
}
