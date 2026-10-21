import { jsonCopy } from "./json.ts";
import type { DurabilityState, Snapshot } from "./contracts.js";

export function needsUnloadWarning(state: DurabilityState): boolean {
  return (
    (state.hosted
      ? state.recoveryFailed || state.pendingComments > 0
      : state.fileDirty) ||
    Object.values(state.drafts).some((draft) => draft.trim().length > 0)
  );
}

export function recoveryKey(
  origin: string,
  fileId: string,
  username: string | null,
): string {
  return "pagegi:view:" + JSON.stringify([origin, fileId, username]);
}

/** Reject stale/corrupt browser caches rather than passing them to the app. */
export function recoverView(
  serialized: string | null,
  revision: string,
): Snapshot | null | undefined {
  if (!serialized) return undefined;
  try {
    const value = JSON.parse(serialized);
    if (value?.format !== 1 || value.sourceRevision !== revision)
      return undefined;
    const snapshot = value.snapshot;
    if (snapshot === null) return null;
    if (
      !snapshot ||
      snapshot.sourceRevision !== revision ||
      !Number.isInteger(snapshot.schema) ||
      snapshot.schema < 0 ||
      !snapshot.state ||
      typeof snapshot.state !== "object" ||
      Array.isArray(snapshot.state) ||
      !snapshot.view ||
      !Number.isFinite(snapshot.view.x) ||
      !Number.isFinite(snapshot.view.y)
    )
      return undefined;
    return jsonCopy(snapshot);
  } catch {
    return undefined;
  }
}
