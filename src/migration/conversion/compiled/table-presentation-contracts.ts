/** Audited no-op/default behavior in the frozen table renderer, never inferred intent. */
export type TablePresentationCompatibility =
  | "ignored-column-width"
  | "ignored-column-entry"
  | "default-table-height";
export interface LegacyTablePresentation {
  readonly columns?: readonly unknown[];
  readonly height?: unknown;
  readonly compatibility: readonly TablePresentationCompatibility[];
}
