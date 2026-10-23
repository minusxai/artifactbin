import type { LocalDeclaration } from "./local-contracts.ts";
export interface CompiledLocalMutationSnapshot {
  values: Record<string, unknown>;
  tables: Record<string, unknown>;
}
export interface CompiledLocalMutationResult {
  scalarValues?: Record<string, unknown>;
  target: string;
  rows: unknown;
  reset?: readonly string[];
}
export type ApplyCompiledLocalMutation = (
  snapshot: CompiledLocalMutationSnapshot,
  current: Record<string, unknown>,
  declarations: readonly LocalDeclaration[],
  result: CompiledLocalMutationResult,
) => Record<string, unknown>;
export interface CompiledLocalMutationPorts {
  read(): CompiledLocalMutationSnapshot;
  execute(
    name: string,
    args: unknown,
    row: unknown,
    snapshot: CompiledLocalMutationSnapshot,
  ): Promise<CompiledLocalMutationResult>;
  /** Atomically compare snapshot tables before committing viewer-owned rows. */
  commit(
    snapshot: CompiledLocalMutationSnapshot,
    result: CompiledLocalMutationResult,
  ): void;
  invalidate(): void;
  changed(pending: boolean): void;
}
