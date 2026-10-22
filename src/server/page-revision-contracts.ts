/** Explicit saved versions are immutable read-only views, including the current head number. */
export type PageRevisionSelection =
  | { kind: "head" }
  | { kind: "saved"; version: number };
export interface SelectedPageRevision {
  version: number;
  historical: boolean;
}
