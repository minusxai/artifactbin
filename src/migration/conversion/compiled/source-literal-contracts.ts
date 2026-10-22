/** Bounds apply to one attribute/declaration, independently of the source byte cap. */
export interface SourceLiteralLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}
export type ReadSourceLiteral = (
  node: unknown,
  limits?: SourceLiteralLimits,
) => unknown;
