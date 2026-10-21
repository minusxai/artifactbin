/**
 * Page addresses that open with given local state: `#af-state=<base64url of
 * the state's UTF-8 JSON, no padding>`. The core loads that state as the
 * viewer's own. shot.mjs --state and comments.mjs --context build them.
 */
import type { AfJson } from "../af-contracts.ts";

export const STATE_FRAGMENT = "af-state";

/** base64url (no padding) of the value's compact UTF-8 JSON. */
export function encodeState(state: AfJson): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

/** `address` with its fragment replaced by `#af-state=…`. */
export function stateAddress(address: string, state: AfJson): string {
  const hash = address.indexOf("#");
  return `${hash < 0 ? address : address.slice(0, hash)}#${STATE_FRAGMENT}=${encodeState(state)}`;
}
