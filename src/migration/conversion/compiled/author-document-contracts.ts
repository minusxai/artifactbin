/** Explicit migration plan. Only the browser executes the admitted authored module. */
export interface CompiledAuthorPlan {
  script: string;
  exports: string[];
  mounts: { identity: string; component: string }[];
}
export interface AuthorDocumentPlan {
  source: string;
  author: CompiledAuthorPlan;
}
