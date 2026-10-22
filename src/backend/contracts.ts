/** JSON is the only value crossing the backend boundary. */
export type BackendJson =
  | null
  | boolean
  | number
  | string
  | BackendJson[]
  | { [key: string]: BackendJson };
/** Authenticated host projection, never accepted from the app's request body. */
export interface BackendPrincipal {
  readonly tenant: string;
  /** The signed-in account, or null for an anonymous viewer. */
  readonly subject: string | null;
}
/** Persist atomically; version covers every executable and schema field. */
export interface CompiledBackend {
  readonly version: string;
  readonly source: string;
  readonly sourceHash: string;
  readonly bundle: string;
  readonly bundleHash: string;
  readonly typeDefs: string;
  readonly fields: readonly string[];
  readonly runtime: string;
  /**
   * Every npm module the bundle was built from: the import as written (a
   * pinned package such as `pg@8.13.1`, or the esm.sh URL a package imported)
   * → the exact esm.sh module it resolved to and its digest. `{}` without
   * packages. A record for reproducing and auditing the bundle; the bundle
   * itself is what runs.
   */
  readonly lockfile: BackendLockfile;
}
export type BackendLockfile = Readonly<
  Record<string, { readonly url: string; readonly integrity: string }>
>;
/**
 * Fetches one module for compilation: `url` is an esm.sh URL; resolves the
 * module's final URL (after esm.sh's `x-esm-path` indirection) and its text.
 * Rejects with a reason a person can act on. src/backend/packages.ts has the
 * real one; tests inject their own.
 */
export type ModuleFetcher = (
  url: string,
  signal?: AbortSignal,
) => Promise<{ url: string; code: string }>;
/** A host-owned package client that cancels and drains its shared network work. */
export type OwnedModuleFetcher = ModuleFetcher & { close(): Promise<void> };
export interface BackendInvocation {
  readonly field: string;
  readonly args: BackendJson;
}
/**
 * The backend file owner's account secrets, validated by the shared policy
 * in src/backend/container/env-policy.mjs,
 * delivered to the resolver as its fourth argument, `env`. The server passes
 * it on every invoke (`{}` when the owner has none); the sandbox delivers it
 * as workerd text bindings, never through `process.env`. Names and values must pass the canonical environment policy; anything else is refused.
 */
export type BackendEnv = Readonly<Record<string, string>>;
/** Trusted backend-file authority, loaded from platform storage, never an app request.
 * A file shares its warm module state across pages/viewers, but never across owners or files.
 */
export interface BackendExecutionScope {
  readonly owner: string;
  readonly fileId: string;
}
/** An explicit reuse decision is required at every adapter boundary. */
export type BackendReuse =
  | { readonly kind: "file"; readonly scope: BackendExecutionScope }
  | { readonly kind: "one-shot" };
export interface BackendInvokeRequest {
  readonly deployment: CompiledBackend;
  readonly principal: BackendPrincipal;
  readonly input: BackendInvocation;
  readonly env: BackendEnv;
  readonly reuse: BackendReuse;
  readonly signal?: AbortSignal;
  readonly capabilityHandler?: BackendCapabilityHandler;
}
export interface BackendHost {
  /** Stop admission, cancel and await all entered work and disposal; repeated calls share completion. */
  close?(): Promise<void>;
  compile(source: string, signal?: AbortSignal): Promise<CompiledBackend>;
  invoke(request: BackendInvokeRequest): Promise<BackendJson>;
}

export type BackendCapabilityRequest =
  | { kind: "invoke"; resource: string; operation: string; input: BackendJson }
  | {
      kind: "transaction";
      resource: string;
      operations: { operation: string; input: BackendJson }[];
    }
  | BackendStoreRequest
  | { kind: "dataset"; operation: "members" }
  | {
      kind: "dataset";
      operation: "person";
      input: { valueName: string; userId: string };
    }
  | {
      kind: "dataset";
      operation: "read";
      input: import("../datasets/contracts.ts").DatasetReadRequest;
    }
  | {
      kind: "dataset";
      operation: "mutate";
      input: import("../datasets/mutation/contracts.ts").DatasetMutationRequest;
    };
/**
 * `caps.store`: the backend file's one JSON document, kept by the platform.
 * The host decides which file; the request never names it.
 */
export type BackendStoreRequest =
  | { kind: "store"; operation: "get" }
  /** Replace the document if its version is still `expected` (0: never written). */
  | { kind: "store"; operation: "set"; value: BackendJson; expected: number };
/** Reply to a store get: the document (null if never written) and its version. */
export interface BackendStoreDocument {
  value: BackendJson;
  version: number;
}
/** Reply to a store set: the new version, or a conflict with the current version. A conflict is a reply, not a failure; a document over the size limit is a BackendStoreLimitError. */
export type BackendStoreWrite =
  | { version: number }
  | { conflict: true; version: number };
/** Trusted handlers must settle their owned work after signal abort. Invocation/host cleanup
 * waits for actual settlement; it cannot forcibly stop arbitrary in-process work. */
export type BackendCapabilityHandler = (
  principal: BackendPrincipal,
  request: BackendCapabilityRequest,
  signal: AbortSignal,
) => Promise<BackendJson>;
export interface BackendHostOptions {
  /** Explicit local Docker image; default is built from src/backend/container. */
  image?: string;
  capabilityHandler?: BackendCapabilityHandler;
  compileTimeoutMs?: number;
  invokeTimeoutMs?: number;
  /** Calls running at once, host-wide (default 8). */
  maxConcurrent?: number;
  /**
   * A call arriving with every slot taken waits this long for one (default
   * 2 s, FIFO) before it is refused `backend_busy`. The wait counts toward no
   * deadline: a call's watchdog starts when it is admitted.
   */
  admitWaitMs?: number;
  /**
   * A sandbox that served a call stays warm this long for the next call to the
   * same backend version (default 60 s). Module state inside it survives between
   * those calls; the skill tells authors never to rely on that.
   */
  warmIdleMs?: number;
  /** At most this many warm sandboxes (default 16, never fewer than maxConcurrent); the least recently used makes room. */
  maxWarm?: number;
  /**
   * After a container of this host could not be proven removed, admission stops
   * until the host proves it gone. A failed proof is retried no sooner than this
   * (default 5 s), on the next call.
   */
  recoveryRetryMs?: number;
  /** One line per admission transition (closed after an unverified cleanup, reopened); default console.error. */
  log?(line: string): void;
  /**
   * The Docker network invocations run on (default `pagegi-sandbox`, created
   * on first use as a bridge without inter-container traffic); `none` gives
   * lambdas no network at all. Inside it workerd allows public addresses only.
   * Compilation always runs with no network.
   */
  sandboxNetwork?: string;
  /** Validated deployment identity; defaults to legacy pagegi. */
  deploymentNamespace?: string;
  /**
   * Loads npm modules at compile time (default: esm.sh, src/backend/packages.ts).
   * The host owns it: closing the host closes it and waits for its close().
   */
  fetchModule?: OwnedModuleFetcher;
}
export type BackendErrorCode =
  | "source_quota"
  | "input_quota"
  | "output_quota"
  | "build_rejected"
  | "schema_rejected"
  | "deployment_invalid"
  | "field_rejected"
  | "backend_rejected"
  | "backend_unavailable"
  | "backend_busy"
  | "cancelled"
  | "deadline"
  | "memory_limit"
  | "cleanup_failed"
  /** A store write over BACKEND_STORE_LIMIT_BYTES reached the resolver uncaught: nothing was saved. */
  | "store_limit"
  | "dataset_changed"
  | "dataset_mutation_rejected";
export class BackendHostError extends Error {
  readonly code: BackendErrorCode;
  /**
   * What the backend said when it failed, as a bounded line (boundedDetail):
   * for `backend_rejected`, the thrown error's message. For the page owner only.
   */
  readonly detail?: string;
  constructor(code: BackendErrorCode, detail?: string) {
    super(code);
    this.code = code;
    this.name = "BackendHostError";
    const bounded = boundedDetail(detail);
    if (bounded !== undefined) this.detail = bounded;
  }
}
/** A trusted dataset read saw a different current version/generation; no rows are returned. */
export class BackendDatasetChangedError extends BackendHostError {
  constructor() {
    super("dataset_changed");
    this.name = "BackendDatasetChangedError";
  }
}
/** A trusted dataset operation was definitely refused before any dataset commit. */
export class BackendDatasetMutationRejectedError extends BackendHostError {
  constructor() {
    super("dataset_mutation_rejected");
    this.name = "BackendDatasetMutationRejectedError";
  }
}
/** A store write refused for size; the sandbox learns this code (never a handler's text) and the resolver may catch it. */
export class BackendStoreLimitError extends TypeError {
  readonly code = "store_limit";
  constructor() {
    super("The store document is limited to 60 KB of JSON");
    this.name = "BackendStoreLimitError";
  }
}
/**
 * A diagnostic fit to show: its first line, control characters removed, at
 * most 200 characters; undefined when nothing is left. Applied wherever a
 * message crosses a trust boundary (sandbox, execution transport, GraphQL).
 */
export function boundedDetail(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const line = text
    .split(/\r?\n/, 1)[0]!
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 200)
    .trim();
  return line || undefined;
}

/**
 * Validate the platform-only execution scope before crossing an execution
 * boundary. A caller never supplies it, so a malformed one is the platform's
 * fault: `deployment_invalid` (the resolver never started), never a quota.
 */
function checkedExecutionScope(input: unknown): BackendExecutionScope {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join() !== "fileId,owner"
  )
    throw new BackendHostError("deployment_invalid");
  const { owner, fileId } = input as BackendExecutionScope;
  if (
    [owner, fileId].some(
      (value) => typeof value !== "string" || !value || value.length > 1024,
    )
  )
    throw new BackendHostError("deployment_invalid");
  return Object.freeze({ owner, fileId });
}

/**
 * Authenticated adapters must make an explicit choice; absence never silently
 * changes isolation. The platform makes it, so a malformed one is `deployment_invalid`.
 */
export function checkedBackendReuse(value: unknown): BackendReuse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BackendHostError("deployment_invalid");
  const reuse = value as { kind?: unknown; scope?: unknown };
  if (reuse.kind === "one-shot" && Object.keys(value).join() === "kind")
    return Object.freeze({ kind: "one-shot" });
  if (
    reuse.kind === "file" &&
    Object.keys(value).sort().join() === "kind,scope"
  ) {
    const scope = checkedExecutionScope(reuse.scope);
    return Object.freeze({ kind: "file", scope });
  }
  throw new BackendHostError("deployment_invalid");
}
