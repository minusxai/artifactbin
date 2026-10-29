/**
 * THE ROUTES' SIDE OF AN ARTIFACT, above the store (lib/artifacts): the wire ↔ storage translation every door shares,
 * so the bearer routes, the cookie routes and the operations registry validate the same fields and answer the same
 * shapes. Body parsers, the read and write echoes, placement from a wire `parent_id`, the metadata PATCH from a body,
 * and the two route adapters (view admission, image references). Nothing here writes; every write is the store's.
 */
export {
  SUMMARY_META_FIELDS, artifactSummaryToWire, artifactToWire, committedOpenAnnotations, createdArtifactWire, parseAccessValue, parseExpectedVersion,
  parseLinkRoleValue, parseParentField, parseShareEntries, parseVisibilityValue, placementFor, replacedArtifactWire, sourceRepairsEcho, versionToWire,
} from './wire';
export { updateMetadataFromBody } from './metadata-wire';
export { monitoringGuidance } from './monitoring-guidance';
export { recordArtifactView } from './view-admission';
export { resolveImageReference } from './image-references';
