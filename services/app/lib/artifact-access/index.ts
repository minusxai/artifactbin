/**
 * THE ACCESS RULE for artifacts: one module for the rule in both languages it is asked in, below the store
 * (lib/artifacts) that loads and writes rows. Nothing here writes the artifacts table.
 *  - The row and the SQL scopes every scoped statement runs under, with the trash gate composed in (./scopes).
 *  - Ownership and the role lattice, decided from a row and the access facts (./access, ./access-facts).
 *  - Dataset grants (policy version 2) and the host-only proofs a saved document's writes carry (./grants).
 *  - The capability table: what an actor's kind allows, and the refusal to answer (./capabilities).
 */
export type { ArtifactRow, Scope } from './scopes';
export {
  LIVE_ARTIFACT_SQL, SHARE_PREDICATE, annotationScope, commentMonitorScope, editorScope, groupMemberPredicate, ownerPredicate, ownerScope,
  policyReaderSql, reactionScope, writerFor,
} from './scopes';
export { documentEditorReaches, effectiveRole, holdsCreatingToken, linkRoleOf, ownsArtifact, roleWithoutLink } from './access';
export { liveAccessFacts, preloadAccessFacts } from './access-facts';
export type { AccessFacts } from './access-facts';
export { assertGrantCommit, grantContext, grantsOf, grantsPermitRead, grantsPermitWrite, readThrough, uploadGrantContext } from './grants';
export type { GrantDocument, ReadRow } from './grants';
export { attestRegisteredHtmlMutation, verifyRegisteredHtmlMutation } from './registered-html-mutation';
export { attestSavedHtmlUpload } from './saved-html-upload';
export { can, capabilityRefusal, refusalFor } from './capabilities';
export type { CapabilityRefusal } from './capabilities';
