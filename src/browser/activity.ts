import type {
  ActivityCallback,
  ActivityParticipant,
  ActivityReason,
  DocumentActivity,
} from "./activity-contracts.ts";

/** Run every callback before reporting failures, including grouped resource ownership. */
export function settleActivityCallbacks(
  callbacks: readonly ActivityCallback[],
  method: keyof ActivityParticipant,
): void {
  const errors: unknown[] = [];
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, `Document activity ${method} failed`);
}

/** Owns nested publication suspension. Participants own the resources they stop. */
export function createDocumentActivity(
  participants: readonly ActivityParticipant[],
): DocumentActivity {
  const reasons = new Set<ActivityReason>();
  let disposed = false;
  function notify(method: keyof ActivityParticipant) {
    settleActivityCallbacks(
      participants.map((participant) => () => participant[method]?.()),
      method,
    );
  }
  return {
    get active() {
      return !disposed && reasons.size === 0;
    },
    suspend(reason) {
      if (disposed || reasons.has(reason)) return;
      const wasActive = reasons.size === 0;
      reasons.add(reason);
      if (wasActive) notify("suspend");
      else notify("invalidate");
    },
    resume(reason) {
      if (disposed || !reasons.delete(reason) || reasons.size) return;
      try {
        notify("resume");
      } catch (error) {
        // A partial resume must not leave publication active after failure.
        reasons.add(reason);
        try {
          notify("suspend");
        } catch {
          /* preserve original failure */
        }
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      notify("dispose");
    },
  };
}
