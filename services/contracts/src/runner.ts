/**
 * Runner boundary: same Promise-based interface locally and over signed HTTP.
 * The trusted app supplies userId; an HTTP adapter must verify it against Actor.
 * Programs never receive caller credentials. JSX parsing and dataflow binding
 * belong to the app's compiler/adapter, not this service.
 */
export type RunnerJson = null | boolean | number | string | RunnerJson[] | { [key: string]: RunnerJson };
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface RunnerLimits {
  timeoutMs: number;
  /** Timeout per synchronous evaluation, NOT a cumulative CPU budget. */
  cpuMs: number;
  memoryMiB: number;
  maxRequests: number;
  maxOutputBytes: number;
}

export interface RunStart {
  /** Deduplicate within this user's runs; a changed payload is a conflict. */
  requestId: string;
  userId: string;
  artifactId?: string;
  /** App pins the published version before submission; not an authorization grant. */
  artifactVersion?: string;
  /** Trusted app snapshot; retained with the run/schedule, never supplied by author code. */
  document?: { source: string; editId: string };
  program: { source: string; language: 'typescript' | 'javascript' };
  input: RunnerJson;
  /** Non-secret program configuration only, never host process.env. */
  env?: Record<string, RunnerJson>;
  /** Backend supplies defaults and clamps requests to its configured ceilings. */
  limits?: Partial<RunnerLimits>;
}

/** Every read/cancel is owner-scoped, including the in-process implementation. */
export interface RunLookup { userId: string; runId: string }
export interface RunEvent { sequence: number; event: RunnerJson }
export interface RunEventPage {
  events: RunEvent[];
  /** Last sequence returned, or the requested cursor if the page was empty. */
  nextSequence: number;
  hasMore: boolean;
}

export interface RunReceipt {
  runId: string;
  status: Exclude<RunStatus, 'queued' | 'running'>;
  reason: string | null;
  admittedAt: string;
  startedAt: string | null;
  finishedAt: string;
  durationMs: number;
  /** Observations may be unavailable; null never means zero. */
  cpuMs: number | null;
  peakMemoryBytes: number | null;
  requests: Array<{
    service: 'artifactbin' | 'ai';
    operation: string;
    durationMs: number;
    status: number | null;
    requestId: string | null;
  }>;
  usage: Array<{ model: string; inputTokens: number | null; outputTokens: number | null }>;
  estimatedDollars: number | null;
  pricingVersion: string | null;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  output: RunnerJson;
  /** Terminal receipt persists independently of event retention. */
  receipt: RunReceipt | null;
}

export interface RunnerService {
  /** Returns after durable admission, not program completion. Runner generates runId. */
  start(input: RunStart): Promise<{ runId: string }>;
  getRun(input: RunLookup): Promise<RunSnapshot>;
  /** Bounded JSON replay; no SSE subscription required. */
  events(input: RunLookup & { afterSequence: number; limit?: number }): Promise<RunEventPage>;
  /** Idempotent; resolves once cancellation is accepted. getRun observes terminal cleanup. */
  cancel(input: RunLookup): Promise<void>;
}
