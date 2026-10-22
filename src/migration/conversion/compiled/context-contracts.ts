/** Source-owned supporting-document metadata, never an import or fetch authority. */
export interface CompiledContextReference {
  readonly legacyId: string;
}
export interface CompiledContextMetadata {
  readonly head: string;
  readonly provenance: readonly CompiledContextReference[];
}
