import type { BackendClock } from "./runtime-contracts.ts";
export interface PackageFetchBudget {
  /** Concurrent unique URL loads across all callers, including retries; default 4. */
  maxConcurrent?: number;
  /** Active plus queued unique loads, including shared pending work; default 64. */
  maxPending?: number;
}
export interface PackageGraphLimits {
  maxModules?: number;
  maxBytes?: number;
  budgetMs?: number;
  /** Concurrent module loads in this graph; default 4. */
  maxConcurrent?: number;
  /** Injected clock for deadlines and cache expiry; tests advance time without real sleeps. */
  timing?: BackendClock;
}
