import type { CompiledDisplayTable } from "./data-control-contracts.ts";
import type { CompiledQueryEvaluation } from "./query-evaluation-contracts.ts";
export interface CompiledQueryPage {
  offset: number;
  limit: number;
  sort?: { col: string; dir: "asc" | "desc" };
}
export interface CompiledQueryAnswer {
  tables: Record<string, CompiledDisplayTable>;
  errors: Record<string, string>;
}
export type CompiledQueryPublication =
  | { state: "pending" }
  | { state: "cleared" }
  | { state: "failed"; errors: Record<string, string> }
  | { state: "settled"; answer: CompiledQueryAnswer };
/** These ports contain no authority, DOM, state subscription or transport ownership. */
export interface CompiledQueryPorts {
  engine: {
    prepare(): void;
    ready(): boolean;
    run(evaluation: CompiledQueryEvaluation): Promise<CompiledQueryAnswer>;
    page(
      name: string,
      page: CompiledQueryPage,
      evaluation: CompiledQueryEvaluation,
    ): Promise<CompiledDisplayTable>;
  };
  evaluation(): Promise<CompiledQueryEvaluation>;
  availability(): "ready" | "blocked" | "failed";
  publish(value: CompiledQueryPublication): void;
  clock: {
    now(): number;
    sleep(ms: number, signal: AbortSignal): Promise<void>;
    schedule(callback: () => void, ms: number): () => void;
  };
}
export interface CompiledQueryConfiguration {
  queries: readonly string[];
  optionQueries: readonly string[];
  /** Total elapsed budget per refresh or page request, including async inputs,
   * readiness, engine execution and option completion. Does not cancel engine work. */
  deadlineMs: number;
}
export interface CompiledQueryController {
  refresh(): Promise<boolean>;
  fetchPage(
    name: string,
    page: unknown,
    columns: readonly { name: string }[],
  ): Promise<CompiledDisplayTable>;
  /** Synchronously cancels stale work and clears published query data. */
  invalidate(): void;
  dispose(): void;
}
