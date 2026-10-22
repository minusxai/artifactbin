/** Explicit migration plan. Only the browser executes the admitted authored module. */
export interface CompiledAuthorPlan {
  script: string;
  /** Absent preserves the existing exported-component ABI. */
  mode?: "components" | "effects";
  /** Source-derived listener-only window ownership; never combined with effect mode. */
  lifecycle?: "owned";
  exports: string[];
  mounts: { identity: string; component: string }[];
}
export interface AuthorDocumentPlan {
  source: string;
  author: CompiledAuthorPlan;
}
