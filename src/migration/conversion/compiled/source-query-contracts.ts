import type { LocalColumnType } from "./local-contracts.ts";
import type { CompiledDisplayTable } from "./data-control-contracts.ts";
import type { CompiledQueryEvaluation } from "./query-evaluation-contracts.ts";
import type { CompiledQueryPage } from "./query-controller-contracts.ts";
/** Offline-attested schema/SQL identity. Credentials and SQL execution remain on the trusted backend. */
export interface CompiledSourceQueryBinding {
  name: string;
  sourceRef: string;
  backendNamespace: "legacyData";
  backendHref: string;
  /** SHA256 of the exact archived Query declaration's SQL, before builtin field rewriting. */
  sqlSha256: string;
  params: Readonly<Record<string, LocalColumnType>>;
  columns: readonly { name: string; type: LocalColumnType }[];
}
export interface CompiledSourceQueryRequest {
  name: string;
  valuesJson: string;
  offset: number;
  limit: number;
  sortJson: string | null;
}
export interface CompiledSourceQueryPorts {
  read(
    binding: CompiledSourceQueryBinding,
    request: CompiledSourceQueryRequest,
  ): Promise<unknown>;
}
export interface CompiledSourceQueryEngine {
  prepare(...args: unknown[]): void;
  ready(...args: unknown[]): boolean;
  run(
    flow: unknown,
    names: readonly string[],
    evaluation: CompiledQueryEvaluation,
  ): Promise<{
    tables: Record<string, CompiledDisplayTable>;
    errors: Record<string, string>;
  }>;
  page(
    flow: unknown,
    name: string,
    page: CompiledQueryPage,
    evaluation: CompiledQueryEvaluation,
  ): Promise<CompiledDisplayTable>;
}
export interface LegacySourceQuerySite {
  name: string;
  sourceRef: string;
  sql: string;
  sqlSha256: string;
}
