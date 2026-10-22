import type { DocumentNode } from "graphql";
import type { AfClient } from "../../../apollo/apollo-contracts.ts";
export type CompiledMutationScalar = string | number | boolean | null;
/** Public routing metadata only: no SQL, storage keys, identities or authority facts. */
export interface CompiledDatasetMutation {
  name: string;
  backendNamespace: string;
  /** SHA-256 of trusted immutable registration; isolates durable recovery across revisions. */
  recoveryScope: string;
  paramTypes: Readonly<
    Record<
      string,
      "string" | "number" | "boolean" | "date" | "timestamp" | "user"
    >
  >;
  reset?: readonly string[];
}
export interface CompiledMutationResult {
  affected: number;
  rowCount: number;
  version: number;
  generation: number;
}
export interface CompiledMutationStatus {
  name: string;
  requestId: string;
  state: "pending" | "committed" | "rejected" | "offline" | "unknown";
  result?: CompiledMutationResult;
}
export interface CompiledDatasetMutationOptions {
  bindings: readonly CompiledDatasetMutation[];
  client: Pick<AfClient, "mutate">;
  /** Fixed trusted GraphQL documents, each selecting namespace.mutate; never authored SQL. */
  documents: Readonly<Record<string, DocumentNode>>;
  requestId(): string;
  values(): Readonly<Record<string, CompiledMutationScalar>>;
  reset(names: readonly string[]): void;
  /** Refetch transient imports after a confirmed commit, including commit replay. */
  committed(): void | Promise<void>;
}
export interface CompiledDatasetMutationAdapter {
  mutate(
    name: string,
    args?: Readonly<Record<string, CompiledMutationScalar>>,
  ): Promise<CompiledMutationResult>;
  /** Reconciles an unknown result with exactly the original requestId and argument snapshot. */
  retry(name: string): Promise<CompiledMutationResult>;
  pending(name?: string): boolean;
  status(name: string): CompiledMutationStatus | null;
  subscribe(listener: () => void): () => void;
}
