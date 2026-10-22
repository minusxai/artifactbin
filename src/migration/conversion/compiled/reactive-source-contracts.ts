/** The archived markup evaluator's read-only vocabulary. No JavaScript calls,
 * ambient objects, computed property access or mutation enters this contract. */
export type LocalReactiveExpression =
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "signal"; readonly name: string }
  | { readonly kind: "row"; readonly field: string }
  | { readonly kind: "not"; readonly value: LocalReactiveExpression }
  | { readonly kind: "binary"; readonly op: "&&" | "||" | "===" | "!==" | "<" | "<=" | ">" | ">="; readonly left: LocalReactiveExpression; readonly right: LocalReactiveExpression };
export interface LocalReactiveRead {
  readonly expression: LocalReactiveExpression;
  readonly signals: readonly string[];
  readonly rowFields: readonly string[];
}
export type ReadLocalReactiveExpression = (node: unknown) => LocalReactiveRead | null;
/** Source IDs remain source owned when rendering is deferred or repeated. A
 * repeat requires a durable typed key and an explicit authored owner ID. */
export type LocalIdentityRegion =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "conditional"; readonly test: LocalReactiveExpression; readonly yes: readonly LocalIdentityRegion[]; readonly no: readonly LocalIdentityRegion[] }
  | { readonly kind: "repeat"; readonly owner: string; readonly table: string; readonly keyBy: string; readonly children: readonly LocalIdentityRegion[] };
export interface LocalDynamicIdentityPlan {
  readonly regions: readonly LocalIdentityRegion[];
}
