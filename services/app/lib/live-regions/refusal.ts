/**
 * Every refusal this module makes, typed by `code`. Callers translate them (a route to a 4xx, publish to its
 * own refusal); nothing here is a silent fallback.
 *
 * - `unsupported_content`: authored region HTML (or an agent's Markdown) holds something the region's kind
 *   cannot represent; `details` names each thing once (`<svg>`, `javascript: link`, ...). Content arriving
 *   while editing (paste, the merged Yjs state) is stripped instead, never refused.
 * - `missing_snapshot`: a revision names no snapshot of the saved version it was made from. Applying it to the
 *   live state directly would delete everyone's synced, unsaved typing, so it is refused, like a stale publish.
 * - `snapshot_mismatch`: the snapshot is not one of this live state's (it names updates the state never saw).
 * - `region_not_found`: the saved page has no editable region with that `data-af-id`.
 */
export type LiveRegionRefusalCode = 'unsupported_content' | 'missing_snapshot' | 'snapshot_mismatch' | 'region_not_found';

export class LiveRegionRefusal extends Error {
  readonly code: LiveRegionRefusalCode;
  readonly details: readonly string[];
  constructor(code: LiveRegionRefusalCode, details: readonly string[] = []) {
    super(details.length ? `${code}: ${details.join(', ')}` : code);
    this.name = 'LiveRegionRefusal';
    this.code = code;
    this.details = details;
  }
}
