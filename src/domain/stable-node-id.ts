import {
  STABLE_NODE_ID_MAX_BYTES,
  type StableNodeIdValidator,
} from "./stable-node-id-contracts.ts";
/** Wire validation only: identity ownership/existence remains the page's authority. */
export const isStableNodeId: StableNodeIdValidator = (value): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= STABLE_NODE_ID_MAX_BYTES &&
  !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value) &&
  new TextEncoder().encode(value).byteLength <= STABLE_NODE_ID_MAX_BYTES;
