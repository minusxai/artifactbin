/**
 * `@afbin/apollo` (owner: brief A). Implementation: src/apollo/client.ts
 * (pure: graphql-js parse/validate only; no DOM, network, timers or storage).
 * The core (src/browser/core/) builds one client per page with the real
 * ports and exposes it as the module `@afbin/apollo`: `export { gql, client }`.
 *
 * One JSON document holds the page's local state. Its top-level keys are the
 * top-level local fields. Backend namespaces (the page's `data-af-name`s) are
 * never stored in it. Local state belongs to one viewer: it is kept in that
 * viewer's browser, never sent to other viewers, and shared data goes through
 * backends instead.
 */
import type { DocumentNode } from "graphql";
import type { HtmlJson as AfJson, HtmlJsonObject as AfJsonObject, PageMutationOutcome as Outcome } from "@artifactbin/contracts";

export type Variables = AfJsonObject;

interface QueryOptions {
  /** Clear remote fields before each read; loading distinguishes this from a completed null answer. */
  clearOnRefresh?:boolean;
  /** Retain results only for trusted same-session data invalidations; reconnects still clear. */
  preserveOnDataRefresh?:boolean;
  query: DocumentNode;
  variables?: Variables;
}
interface MutationOptions {
  mutation: DocumentNode;
  variables?: Variables;
}
export interface ResultError {
  message: string;
  path?: (string | number)[];
}
export interface QueryResult<T = AfJsonObject> {
  /** Backend watch lifecycle only. True while reading, false for an answer or error. */
  loading?:boolean;
  data: T;
  errors?: ResultError[];
}
export interface MutationResult<T = AfJsonObject> {
  data: T | null;
  errors?: ResultError[];
  /** One entry per backend mutation field, keyed by response path joined with "." (e.g. "billing.pay"). */
  extensions?: { outcomes: Record<string, Outcome> };
}
interface Subscription {
  unsubscribe(): void;
}
export interface ObservableQuery<T = AfJsonObject> {
  /** Calls `next` straight away with the current data, then whenever a top-level field the query names changes. */
  subscribe(next: (result: QueryResult<T>) => void): Subscription;
}

/** Local named mutations: `(draft, args) => result`. The resolver changes `draft` (the whole local document) directly. */
export type LocalResolver = (draft: AfJsonObject, args: AfJsonObject) => AfJson | void;
export interface LocalResolvers {
  Mutation?: Record<string, LocalResolver>;
}

export interface AfClient {
  /**
   * Local fields: projected from the document by the selection set. A field
   * never written is null. A field with a selection set maps over arrays and
   * picks keys from objects; a field without one returns its whole value.
   * Arguments on local fields are an error. Backend namespaces go to the
   * remote port in one request; local and remote results are merged into `data`.
   */
  query<T = AfJsonObject>(options: QueryOptions): Promise<QueryResult<T>>;
  /**
   * Top-level fields run in the order written: local named mutations (from
   * addResolvers) on the document, backend namespaces through the remote port.
   * Consecutive backend fields may share one request. Remote results are
   * never written into local state. Offline: nothing is sent, every backend
   * field is null with an error and outcome "offline". If the remote port
   * throws anything but RemoteUnreachable after sending, outcomes are
   * "unknown" and the request is not retried.
   * A local resolver that throws saves nothing; its error is in `errors`.
   */
  mutate<T = AfJsonObject>(options: MutationOptions): Promise<MutationResult<T>>;
  /** Watches local fields and backend namespaces. Backend invalidations/reconnects refresh results without persisting them. */
  watchQuery<T = AfJsonObject>(options: QueryOptions): ObservableQuery<T>;
  /**
   * Local fields only. Calls `fn` with the data in the query's shape and saves
   * what it returns: each top-level field the query names is replaced by the
   * returned value (subfields you don't select are dropped); other fields are
   * untouched. Returning a key the query doesn't name rejects. Values must be
   * storable (see assertStorable) or the call rejects and nothing is saved.
   * Compare-and-swap: if any named field changed before the write lands, `fn`
   * runs again with the new data (at most `maxAttempts` times in total). The
   * promise resolves with the saved data once the store commits it.
   */
  updateQuery<T = AfJsonObject>(
    options: QueryOptions,
    fn: (data: T) => T,
  ): Promise<T>;
  /** Register local named mutations. Later registrations of the same name replace earlier ones. */
  addResolvers(resolvers: LocalResolvers): void;
}

/** A write against the document: replace top-level fields if they still hold the expected values. */
export interface StoreWrite {
  /** Top-level field → value it must still have (undefined: must be absent). */
  expected: Record<string, AfJson | undefined>;
  /** Top-level field → new value (undefined: remove the field). */
  next: Record<string, AfJson | undefined>;
  /** True: the document must also have no top-level field outside `expected` (one added meanwhile conflicts). */
  exact?: boolean;
}
export type StoreReceipt =
  | { status: "committed"; document: AfJsonObject }
  | { status: "conflict"; document: AfJsonObject }
  | { status: "rejected"; document: AfJsonObject; error: string };

/**
 * Where the viewer's document lives: browser storage keyed by the page
 * (src/browser/core/standalone.ts persistentStore), or memory
 * (createLocalStore). Listeners run after every change to the document,
 * including a change made in another tab of the same viewer.
 */
export interface StatePort {
  read(): AfJsonObject;
  subscribe(listener: (document: AfJsonObject) => void): () => void;
  write(change: StoreWrite): Promise<StoreReceipt>;
}

export class RemoteUnreachable extends Error {
  constructor(message = "offline") {
    super(message);
    this.name = "RemoteUnreachable";
  }
}
/** The page's backend endpoint (POST /api/files/:id/graphql through the platform frame). */
export type QueryInvalidation = "data" | "authority";
export interface RemotePort {
  /** Invalidation/reconnection signal only; never carries results or credentials. */
  /** May notify synchronously; the returned cleanup is owned exactly once, even if the observer closes during setup. */
  subscribe?(listener:(reason?:QueryInvalidation)=>void):()=>void;
  online(): boolean;
  /** Queries alone may await a bounded, already pending connection. The returned sender rejects after cancellation. */
  whenReady?(): Promise<RemotePort["execute"] | null>;
  /**
   * The request holds only backend namespaces. Throws RemoteUnreachable only
   * when nothing was sent; any other throw means the outcome is unknown.
   */
  execute(request: {
    query: string;
    variables: Variables;
    operation: "query" | "mutation";
  }): Promise<{
    data: AfJsonObject | null;
    errors?: ResultError[];
    extensions?: { outcomes: Record<string, Outcome> };
  }>;
}

export interface ClientOptions {
  /** The page's `data-af-name`s. */
  backends: readonly string[] | (() => readonly string[]);
  state: StatePort;
  /** Omitted when the page links no backends. */
  remote?: RemotePort;
  /** updateQuery / local mutation attempts before rejecting with a conflict error. Default 10. */
  maxAttempts?: number;
}

/** `#af-state=<base64url of the local-state JSON>` on a page address loads that state for the viewer. */
export const AF_STATE_FRAGMENT = "af-state";
/** Largest `#af-state` document, in bytes of decoded JSON (256 KB). */
export const AF_STATE_URL_LIMIT = 256 * 1024;

/** What a page address's fragment says about local state. */
export interface StateFragment {
  /** `#af-state=` was present. */
  found: boolean;
  /** The decoded state, or null when absent or unusable. */
  state: AfJsonObject | null;
  /** Why a present `#af-state` was ignored (malformed, too large, not storable). */
  error: string | null;
  /** The fragment without `af-state`, with its leading "#", or "" when nothing is left. */
  rest: string;
}
