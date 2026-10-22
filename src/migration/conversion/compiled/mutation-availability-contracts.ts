import type { CompiledDatasetMutation } from "./dataset-mutations-contracts.ts";
/** Advisory only. The server rechecks policy on every actual save. */
export interface CompiledMutationAvailabilityPorts {
  bindings: readonly Pick<
    CompiledDatasetMutation,
    "name" | "backendNamespace"
  >[];
  watch(
    binding: Pick<CompiledDatasetMutation, "name" | "backendNamespace">,
    receive: (value: unknown) => void,
  ): () => void;
  changed(): void;
}
export interface CompiledMutationAvailability {
  unavailable(name: string): string | null;
  /** Invalidate all prior receipts before reattaching canonical watches. */
  reconnect(): void;
  dispose(): void;
}
