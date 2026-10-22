import type { BackendHost, BackendCapabilityHandler } from "./contracts.ts";
export interface ExecutionLimits {
  maxConcurrent?: number;
  deadlineMs?: number;
  maxFrameBytes?: number;
  maxFrames?: number;
}
export interface ExecutionServiceOptions extends ExecutionLimits {
  host: BackendHost;
  datasetSql?: import("./dataset-sql-contracts.ts").DatasetSqlExecutor;
  imageProcessor?: import("../media/image-processing/contracts.ts").ImageJobExecutor;
  secret: string;
}
export interface RemoteBackendOptions extends ExecutionLimits {
  endpoint?: string;
  socketPath?: string;
  secret: string;
  capabilityHandler?: BackendCapabilityHandler;
}

export interface ExecutionServiceLifecycle {
  close(): Promise<void>;
}
export type RemoteBackendHost = BackendHost & { close(): Promise<void> };

/**
 * The first frame of a remote invoke (remoteBackendHost → createExecutionService):
 * `env` is the backend owner's secrets (BackendEnv), passed to the service's
 * host unchanged; absent or not a plain object of strings is an invalid request.
 */
export interface RemoteInvokeFrame {
  kind: "invoke";
  deployment: import("./contracts.ts").CompiledBackend;
  principal: import("./contracts.ts").BackendPrincipal;
  input: import("./contracts.ts").BackendInvocation;
  env: import("./contracts.ts").BackendEnv;
  /** Required explicit disposition, supplied by the authenticated platform. */
  reuse: import("./contracts.ts").BackendReuse;
}

/** Runs one `docker` CLI command and resolves its trimmed stdout; rejects on failure or timeout. */
export type DockerCommand = (
  args: readonly string[],
  timeoutMs?: number,
) => Promise<string>;

/**
 * The execution controller's startup cleanup: removes the backend containers a
 * previous controller of this deployment left behind (legacy label `pagegi.backend=1`,
 * generated names), verifying ownership of every one before removing any and
 * that none remain after. Resolves the number removed; rejects on any doubt,
 * and the controller must then stay closed. Up to 1024 candidates are inspected
 * in batches of 16; all candidates must pass ownership validation before any
 * removal. Removal uses batches of 16, stopping on failure. Larger inventories
 * require operator intervention rather than unbounded startup work. The whole
 * cleanup has a 30-second budget, including command time.
 */
export interface ReaperOptions {
  /** Validated deployment identity; defaults to legacy pagegi. */
  deploymentNamespace?: string;
  /** Monotonic milliseconds, injected for deadline tests. Defaults to performance.now. */
  now?: () => number;
}
export type ReapBackendContainers = (
  docker: DockerCommand,
  options?: ReaperOptions,
) => Promise<number>;
