import type { NativeTypedAnalysis } from "./analyze-contracts.ts";
import type { MigrationQueryFlow } from "../query-preparation-contracts.ts";

export interface NativeOperationReads {
  imports: readonly string[];
  queries: readonly string[];
  values: readonly string[];
  builtins: readonly string[];
}
export interface NativeCompiledQuery {
  name: string;
  engine: string;
  source?: string;
  sql: string;
  params: readonly string[];
  columns: readonly { name: string; type: string | null }[];
  reads: NativeOperationReads;
  /** SQLite authorizer facts, not keyword matches or a guessed SQL AST. */
  functions: readonly string[];
}
export interface NativeCompiledMutation {
  name: string;
  sql: string;
  target: { import?: string; table?: string; local?: string };
  args: readonly { name: string; type: string | null }[];
  reads: NativeOperationReads;
  rowTypes?: Readonly<Record<string, string | null>>;
  valueType?: string | null;
  expectedAffected?: number;
  reset?: readonly string[];
}
/** A compiler adapter must pin its source hash before/after extraction and use real catalog receipts. */
export interface NativeOperationCompilation {
  sourceSha256: string;
  compilerSourceSha256: string;
  sqlEngineSha256: string;
  imports: MigrationQueryFlow["imports"];
  values: MigrationQueryFlow["values"];
  queries: readonly NativeCompiledQuery[];
  mutations: readonly NativeCompiledMutation[];
}
export type NativeOperationRoute =
  | "registered-sqlite-query"
  | "registered-catalog-query"
  | "registered-dataset-mutation"
  | "apollo-local-mutation"
  | "native-vega"
  | "native-single-value"
  | "historical-readonly";
export type NativeOperationGuarantee =
  | "typed-null-parameters"
  | "catalog-source-authority"
  | "full-source-results"
  | "dependency-order"
  | "actor-clock-bindings"
  | "cancel-stale-results"
  | "revision-authority-fence"
  | "expected-affected"
  | "commit-only-reset"
  | "outcome-no-retry"
  | "vega-spec-signals"
  | "single-value-dom";
export interface NativeDatasetOperationBinding {
  name: string;
  ref: string;
  version: number;
  catalogSha256: string;
  policySha256: string;
  /** Bare legacy refs resolve current datasets even from archived page revisions. */
  selection: "live-current" | "pinned-version";
}
/** Exact current catalog receipt, kept independent of imports for direct-source SQL. */
export interface NativeCatalogOperationBinding {
 sourceRef:string;
 targetDatasetId:string;
 version:number;
 catalogSha256:string;
 policySha256:string;
 selection:"live-current";
}
/** Produced/verified by a separate trusted registration step; no registration or execution happens here. */
export interface NativeOperationAdmission {
  kind: "query" | "mutation" | "visualization";
  name: string;
  operationSha256: string;
  planSha256: string;
  route: NativeOperationRoute;
  guarantees: readonly NativeOperationGuarantee[];
  datasets: readonly NativeDatasetOperationBinding[];
  source?:NativeCatalogOperationBinding;
}
export interface NativeOperationAnalysisInput {
  analysis: NativeTypedAnalysis;
  compilation: NativeOperationCompilation;
  historical: boolean;
  /** Separate engine/function-library pin; retained JSX extraction pin alone is insufficient. */
  sqlEngineSha256: string;
  admissions?: readonly NativeOperationAdmission[];
}
export interface NativeOperationBlocker {
  code: string;
  sourceNode: string;
  operation: string;
}
/** A static visualization retains its literal source Value node and complete ordered table. */
export type NativeVisualizationSourceBinding =
  | {kind:"query-result";name:string}
  | {kind:"static-table-value";name:string;sourceNode:string;sourceNodeSha256:string;rowsSha256:string;columnsSha256:string};
export interface NativeOperationProof {
  kind: "query" | "mutation" | "visualization";
  name: string;
  sourceNode: string;
  operationSha256: string;
  route: NativeOperationRoute;
  dependencies: readonly string[];
  requiredGuarantees: readonly NativeOperationGuarantee[];
  visualizationSource?: NativeVisualizationSourceBinding;
  /** A matching receipt is preparation evidence, never a runtime or visual parity pass. */
  status: "attested-plan" | "blocked";
}
export interface NativeOperationCoverage {
  sourceSha256: string;
  compilerSourceSha256: string;
  sqlEngineSha256: string;
  operations: readonly NativeOperationProof[];
  queryOrder: readonly string[];
  blockers: readonly NativeOperationBlocker[];
}
