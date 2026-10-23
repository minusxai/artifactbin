/** Explicit offline view only. This is neither rendering admission nor executable program registration. */
export interface InactiveServerDocument {
  readonly mode: "archived-inactive";
  /** Digest of the complete, unmodified canonical source retained by the existing archive. */
  readonly originalSourceSha256: string;
  /** Temporary compiler input only. Never replace the archived source or cache as an original revision. */
  readonly renderSource: string;
  readonly handler: {
    readonly status: "archived-inactive";
    readonly sourceSha256: string;
    readonly reason: "execution-not-enabled";
  };
  /** Body dataset actions are independent of invoking the archived server handler.
   * Their ordinary authority/admission remains mandatory; they are not enabled by this view. */
  readonly body: {
    readonly declaredDatasetMutations: number;
    readonly mutationControls: number;
  };
  /** Any eventual renderer must visibly retain this limitation. */
  readonly limitation: "Archived server handler is unavailable; execution is not enabled.";
}
export type PrepareInactiveServerDocument = (
  source: string,
  options: { readonly mode: "archived-inactive" },
) => InactiveServerDocument;
/** Explicit exact-source declaration; never inferred from failed server registration. */
export interface ArchivedInactiveServerAdmission {
  readonly mode: "archived-inactive";
  readonly originalSourceSha256: string;
  readonly handlerSourceSha256: string;
  readonly renderSourceSha256: string;
}
export interface ArchivedInactiveServerPageAdmission
  extends ArchivedInactiveServerAdmission {
  readonly legacyId: string;
  readonly version: number;
}
