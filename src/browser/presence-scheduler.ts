import type {
  PresenceScheduler,
  PresenceSchedulerOptions,
} from "./presence-scheduler-contracts.ts";
/** Debounced view presence and throttled cursor read fresh values only at dispatch. */
export function createPresenceScheduler(
  options: PresenceSchedulerOptions,
): PresenceScheduler {
  const clock = options.clock ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) =>
      clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let pending: unknown, cursor: unknown, selection: unknown;
  const send = () => {
    clock.clearTimeout(pending);
    pending = undefined;
    const state = options.read();
    if (state.active && state.authenticated) options.publish(state.presence);
  };
  return {
    send,
    schedule() {
      clock.clearTimeout(pending);
      pending = clock.setTimeout(send, 100);
    },
    selection() {
      if (selection !== undefined) return;
      selection = clock.setTimeout(() => {
        selection = undefined;
        send();
      }, 75);
    },
    cursor() {
      if (cursor !== undefined) return;
      cursor = clock.setTimeout(() => {
        cursor = undefined;
        const state = options.read();
        if (
          state.active &&
          state.authenticated &&
          state.presence.shareCursor &&
          state.presence.visible
        )
          options.publishCursor(state.presence.cursor ?? null);
      }, 50);
    },
    cancel() {
      clock.clearTimeout(pending);
      clock.clearTimeout(cursor);
      clock.clearTimeout(selection);
      pending = cursor = selection = undefined;
    },
  };
}
