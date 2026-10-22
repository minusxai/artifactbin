/** Compiler graph requirements, not page authority or runtime permissions. */
export type ArchivedRuntimeCapability =
  | "sql"
  | "author"
  | "charts"
  | "dataset-mutations"
  | "data-controls"
  | "slide-deck"
  | "mermaid"
  | "dialog-focus"
  | "person"
  | "viewer"
  | "members"
  | "fonts"
  | "context";
export type ArchivedKitGraph = "manifest" | "source";
export interface ArchivedRuntimePlan {
  readonly capabilities: readonly ArchivedRuntimeCapability[];
  /** Solid and the archived kit must always come from this same graph. */
  readonly kitGraph: ArchivedKitGraph;
}
export interface ArchivedRuntimeRequirements {
  readonly sql: boolean;
  readonly author: boolean;
  readonly charts: boolean;
  readonly datasetMutations: boolean;
  readonly dataControls: boolean;
  readonly slideDeck: boolean;
  readonly mermaid: boolean;
  readonly dialogFocus: boolean;
  readonly person: boolean;
  readonly viewer: boolean;
  readonly members: boolean;
  readonly fonts: boolean;
  readonly context: boolean;
}
