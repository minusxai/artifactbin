import type { LocalDeclaration } from "./local-contracts.ts";
/** Source-owned state contract, derived without executing source or trusting the
 * archived compiler. Defaults and table column order are migration semantics. */
export interface LocalSourceManifest {
  readonly declarations: readonly LocalDeclaration[];
}
export type ReadLocalSourceManifest = (source: string) => LocalSourceManifest;
/** Compiler JSON is untrusted at this boundary; a valid but different type,
 * default, row set or schema is not a successful migration. */
export type ReconcileLocalDeclarations = (
  manifest: LocalSourceManifest,
  declarations: unknown,
) => boolean;

/** A successfully admitted source owns its complete capability and state manifest.
 * Compiler output may implement this plan; it cannot add or reinterpret it. */
export interface AdmittedLocalSource {
  readonly input: import("./contracts.ts").CompiledMigrationInput;
  readonly manifest: LocalSourceManifest;
  /** Authored IDs on rendered JSX nodes must survive compiler output unchanged. */
  readonly renderedIdentities: ReadonlySet<string>;
  readonly dynamicIdentities: import("./reactive-source-contracts.ts").LocalDynamicIdentityPlan;
  readonly historical: boolean;
  readonly backendLinks: ReadonlyMap<string, string>;
  readonly queryNames: ReadonlySet<string>;
  readonly datasetNames: ReadonlySet<string>;
  readonly mutationNames: ReadonlySet<string>;
  readonly chartCount: number;
  readonly vegaCount: number;
  readonly author?: import("./author-document-contracts.ts").CompiledAuthorPlan;
}
export type LocalSourceAdmission =
  | { readonly ok: true; readonly plan: AdmittedLocalSource }
  | { readonly ok: false; readonly code: string };
export type AdmitLocalSource = (
  input: import("./contracts.ts").CompiledMigrationInput,
) => LocalSourceAdmission;
