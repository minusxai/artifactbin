import type { RemoteAccessSnapshot } from "../apollo/apollo-contracts.ts";
/** Only platform policy/lifecycle facts enter this projection; no username heuristic. */
export function remoteAccessSnapshot(input: {
  epoch: number;
  active: boolean;
  historical: boolean;
  phase: RemoteAccessSnapshot["state"];
  context: string | null;
}): RemoteAccessSnapshot {
  const state =
    !input.active || input.historical
      ? "denied"
      : input.phase === "allowed"
        ? input.context
          ? "allowed"
          : "pending"
        : input.phase;
  return {
    epoch: input.epoch,
    state,
    context: state === "allowed" ? input.context : null,
  };
}

/** Per-surface opaque generation; identity replacement retires queued startup work. */
export function createRemoteAccess() {
  let epoch = 0,
    lastContext: string | null = null;
  return {
    invalidate(): RemoteAccessSnapshot {
      epoch++;
      lastContext = null;
      return { epoch, state: "pending", context: null };
    },
    project(
      input: Omit<Parameters<typeof remoteAccessSnapshot>[0], "epoch">,
    ): RemoteAccessSnapshot {
      if (input.context) {
        if (lastContext !== null && lastContext !== input.context) epoch++;
        lastContext = input.context;
      }
      return remoteAccessSnapshot({ ...input, epoch });
    },
  };
}
