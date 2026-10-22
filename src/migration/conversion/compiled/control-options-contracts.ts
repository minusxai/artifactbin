import type {
  CompiledDisplayTable,
  CompiledDataControlLimits,
} from "./data-control-contracts.ts";
/** One completion attempt owns its deadline, cancellation and page reader. No automatic retries. */
export interface CompiledControlOptionsRuntime {
  readonly now?: () => number;
  /** Schedule once; returned disposer must cancel the callback. */
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
  readonly signal?: AbortSignal;
}
export type CompleteControlOptions = (
  initial: CompiledDisplayTable,
  read: (
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<CompiledDisplayTable>,
  limits?: Partial<CompiledDataControlLimits>,
  runtime?: CompiledControlOptionsRuntime,
) => Promise<CompiledDisplayTable>;
/** One boot owns these attempts; superseding or disposing aborts pending completion. */
export interface CompiledControlOptionsAttempt {
  readonly signal: AbortSignal;
  finish(): void;
}
export interface CompiledControlOptionsLifecycle {
  begin(): CompiledControlOptionsAttempt | null;
  dispose(): void;
}
