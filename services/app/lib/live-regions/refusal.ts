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
 *
 * An incoming update (validateRegionUpdate, validate.ts) is refused, before it is stored or relayed, with the
 * contract's codes (@artifactbin/contracts RegionRefusalCode): `unsupported_content` (undecodable, or content or a
 * format outside the region's schema), `foreign_client` (a struct written under another client id),
 * `outside_region` (an item outside the region's one root text), `out_of_order` (it depends on something the state
 * does not hold yet; `stateVector` says what it holds) and `too_large`.
 */
type LiveRegionRefusalCode = 'unsupported_content' | 'missing_snapshot' | 'snapshot_mismatch' | 'region_not_found'
  | 'foreign_client' | 'outside_region' | 'out_of_order' | 'too_large';

export class LiveRegionRefusal extends Error {
  readonly code: LiveRegionRefusalCode;
  readonly details: readonly string[];
  /** With `out_of_order`: the state vector of the state the update was checked against. */
  readonly stateVector?: Uint8Array;
  constructor(code: LiveRegionRefusalCode, details: readonly string[] = [], stateVector?: Uint8Array) {
    super(details.length ? `${code}: ${details.join(', ')}` : code);
    this.name = 'LiveRegionRefusal';
    this.code = code;
    this.details = details;
    if (stateVector) this.stateVector = stateVector;
  }
}
