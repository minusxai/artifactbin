/** A mutation-only page retains imports as verified metadata; no read query is invented. */
export interface MutationOnlyImportInput {
  queryNames: readonly string[];
  localMutationNames: readonly string[];
  declaredMutationNames: readonly string[];
  registeredMutationNames: readonly string[];
}
