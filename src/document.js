// Small page helpers shared by the server and tests: credential hashing, the
// source digest the hosted runtime keys a version by, and an empty document
// state for that source.
export { hash, json, documentTitle } from "./server/text.ts";
import { sourceDigest } from "./server/page-ports.ts";
export const revision = sourceDigest;
/** @returns {import("./contracts.ts").DocumentState} */
export function initialState(source) {
  return {
    format: 1,
    fileId: null,
    sourceRevision: revision(source),
    remote: null,
    anchors: {},
    comments: [],
    pending: [],
    app: null,
    snapshots: {},
    publishRequest: crypto.randomUUID(),
  };
}
