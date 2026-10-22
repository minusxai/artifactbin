import type { SavedQueryInvocation } from "../persistence/dataset-queries-contracts.ts";
/** Normal GraphQL execution supplies this saved authority, never resolver arguments. */
export interface SavedProgramHost {
  /** null means no matching admitted program; otherwise the exact JSON-encoded result. */
  invoke(
    invocation: SavedQueryInvocation,
    inputJson: string,
    signal: AbortSignal,
  ): Promise<string | null>;
}
