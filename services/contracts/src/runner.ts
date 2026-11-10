/**
 * Runner boundary: same Promise-based interface locally and over signed HTTP.
 * The trusted app supplies userId; an HTTP adapter must verify it against Actor.
 * Programs never receive caller credentials. JSX parsing and dataflow binding
 * belong to the app's compiler/adapter, not this service.
 */
export type RunnerJson = null | boolean | number | string | RunnerJson[] | { [key: string]: RunnerJson };
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

/**
 * One resolver call's size and time limits, as a single table: they move together. Raising the
 * fetch response cap means raising every link after it (worker message, remote callback reply).
 */
/**
 * How many scheduled page functions one publisher may have active across the live page heads whose content it
 * published (lib/artifacts schedule-capacity: an invariant every transaction that activates schedules checks).
 */
export const FUNCTION_SCHEDULE_LIMIT = 20;
export const RESOLVER_LIMITS = Object.freeze({
  /** `caps.fetch` response body, before redaction. */
  fetchResponseBytes: 2 * 1024 * 1024,
  /** `caps.fetch` request body, after placeholders are filled. */
  fetchRequestBodyBytes: 256 * 1024,
  /** One `caps.fetch`, every redirect hop included. */
  fetchTimeoutMs: 10_000,
  /** One controller/worker line, and the app's reply to a remote capability callback: room for a full answer plus its envelope. */
  messageBytes: 8 * 1024 * 1024,
  /** A resolver's own result: the same 4 MiB a page's generated dataset API answers. */
  outputBytes: 4 * 1024 * 1024,
  /** Resolver wall time in the runner. */
  wallMs: 15_000,
  /** How long the app waits for a run: wall time plus one second. */
  appWaitMs: 16_000,
  maxRequests: 32,
  /** One `caps.query` GraphQL document. */
  queryDocumentBytes: 16 * 1024,
  /** One `caps.query` answer's `data`, and one `caps.sql` answer. */
  queryResultBytes: 4 * 1024 * 1024,
  /** The longest one `getRun` holds a completion wait open; below the runner client's 30 s request timeout. */
  runWaitMs: 20_000,
});
/**
 * `caps.db`: the database tunnel's limits, enforced by the runner controller that opens the TCP
 * connection (services/runner `database-tunnel.ts`). Counts per owner and per page are per controller.
 */
export const RESOLVER_DATABASE_LIMITS = Object.freeze({
  /** Tunnels one run may open in total (a driver reconnect counts again). */
  connectionsPerRun: 4,
  /** Tunnels open at once for one page owner, and for one page, across that controller's runs. */
  connectionsPerOwner: 16,
  connectionsPerPage: 8,
  /** DNS lookup plus TCP connect, every vetted address tried included. */
  connectTimeoutMs: 5_000,
  /** A tunnel with no bytes either way for this long is closed. */
  idleTimeoutMs: 10_000,
  /** Bytes from the database to the run, and from the run to the database, over all its tunnels. */
  bytesInPerRun: 16 * 1024 * 1024,
  bytesOutPerRun: 4 * 1024 * 1024,
  /** Bytes in flight per tunnel and direction before the sender waits for an acknowledgement. */
  windowBytes: 256 * 1024,
  /** Largest payload of one tunnel message. */
  chunkBytes: 64 * 1024,
  /** Tunnel messages one run may send the controller. */
  messagesPerRun: 50_000,
  /** Lowest port a connection may name: database servers listen on unprivileged ports. */
  minPort: 1024,
});
/** The host operation that answers a named connection; the worker calls it, resolver code cannot. */
export const RESOLVER_DATABASE_OPERATION = 'artifactbin.pageBackend.db';
/**
 * The runner worker's own check before each `caps.db` query (worker-database.mjs; resolver code cannot send it): the
 * app re-decides the call's admission, so a revoked caller's open connection stops at its next query. It is not
 * counted against the run's request limit.
 */
export const RESOLVER_DATABASE_CHECK_OPERATION = 'artifactbin.pageBackend.dbCheck';
/**
 * The database kinds `caps.db` connects to, THE ONE LIST: a `secrets` export binding of one of these
 * (`{DB: 'postgres'}`, `{DB: 'mysql'}`) declares a connection of that kind instead of a fetch secret. Compile-time
 * validation, the stored connection, the Resolvers panel and the runner worker's driver choice all read it.
 */
export const RESOLVER_DATABASE_KINDS = Object.freeze(['postgres', 'mysql'] as const);
export type ResolverDatabaseKind = (typeof RESOLVER_DATABASE_KINDS)[number];
export const isResolverDatabaseKind = (value: unknown): value is ResolverDatabaseKind =>
  typeof value === 'string' && (RESOLVER_DATABASE_KINDS as readonly string[]).includes(value);
/** What a run receipt records for one `caps.fetch`: never a query string, header value or body. */
export interface ResolverFetchReceipt {
  method: string;
  host: string;
  /** The request path as written, `{{NAME}}` placeholders unfilled. */
  path: string;
  bytesIn: number;
  bytesOut: number;
  /** Names of the secrets the host filled in. */
  secrets: string[];
}

export interface RunnerLimits {
  timeoutMs: number;
  /** Timeout per synchronous evaluation, NOT a cumulative CPU budget. */
  cpuMs: number;
  memoryMiB: number;
  maxRequests: number;
  maxOutputBytes: number;
}

export interface RunStart {
  /** Trusted app operation authority; absent authority never permits backend writes. */
  pageBackendOperation?: 'query' | 'mutation';
  name?: string;
  command?: string[]; // Native argv; requires an empty program source.
  compute?: { vcpu: number; memoryMiB: number; ttlSeconds: number; idleSeconds?: number };
  sshPublicKey?: string;
  /** Deduplicate within this user's runs; a changed payload is a conflict. */
  requestId: string;
  userId: string;
  artifactId?: string;
  /** Version loaded for this execution. */
  artifactVersion?: string;
  /** Trusted app snapshot; retained with the execution attempt, never supplied by author code. */
  document?: { source: string; editId: string };
  program: { source: string; language: 'typescript' | 'javascript' };
  input: RunnerJson;
  /** Non-secret program configuration only, never host process.env. */
  env?: Record<string, RunnerJson>;
  /** Backend supplies defaults and clamps requests to its configured ceilings. */
  limits?: Partial<RunnerLimits>;
}

/** Every read/cancel is owner-scoped, including the in-process implementation. */
interface RunLookup { userId: string; runId: string }
export interface RunWait extends RunLookup { waitMs?: number }
export interface RunEvent { sequence: number; event: RunnerJson }
interface RunEventPage {
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
    service: 'artifactbin' | 'fetch';
    operation: string;
    durationMs: number;
    status: number | null;
    requestId: string | null;
    fetch?: ResolverFetchReceipt;
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
  /**
   * With `waitMs`, returns once the run is terminal or that long has passed (capped at
   * `RESOLVER_LIMITS.runWaitMs`). An implementation that ignores it returns at once.
   */
  getRun(input: RunWait): Promise<RunSnapshot>;
  /** Bounded JSON replay; no SSE subscription required. */
  events(input: RunLookup & { afterSequence: number; limit?: number }): Promise<RunEventPage>;
  /** Idempotent; resolves once cancellation is accepted. getRun observes terminal cleanup. */
  cancel(input: RunLookup): Promise<void>;
}
