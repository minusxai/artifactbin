/**
 * Backend files (owner: brief C). A backend file is one TypeScript module with
 * its own file ID, linked from pages with
 * `<link rel="af-backend" href="…/af/v1/ids/<id>" data-af-name="<name>">`.
 *
 *   import { gql } from '@afbin/apollo';          // the only import allowed
 *   export const typeDefs = gql`…`;               // or a plain string; no ${…}
 *   export default { Query: {…}, Mutation: {…} }; // resolvers(args, principal, caps)
 *
 * Execution reuses the existing isolated host (src/backend/container-host.ts,
 * execution-service.ts, capability-authority.ts): fresh container per call,
 * no network, `caps.invoke`/`caps.transaction` for operator-connected resources,
 * `caps.store` for the file's one platform-kept JSON document (BackendStore).
 * Compilation maps `@afbin/apollo` to a built-in shim whose `gql` returns the
 * template's string; any other import is `build_rejected`.
 */
import type { FileId } from "../af-contracts.ts";
import type { CompiledBackend } from "./contracts.ts";
/** Structurally the SqlClient of src/persistence/sql.ts (a server module contracts may not import). */
export interface SqlClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}
/** Structurally the SqlDatabase of src/persistence/sql.ts. */
export interface SqlDatabase {
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}
import type { BackendLink } from "../page/page-contracts.ts";
import type { AfRouteModule } from "../server/af-api-contracts.ts";

export type BackendModuleProblem =
  | "typedefs-missing"
  /** typeDefs is not a string literal or a gql template without substitutions. */
  | "typedefs-not-static"
  | "default-export-missing"
  | "import-not-allowed"
  | "schema-invalid"
  /** The file is not parseable JavaScript/TypeScript. */
  | "syntax-invalid";

export class BackendModuleError extends Error {
  readonly problem: BackendModuleProblem;
  constructor(problem: BackendModuleProblem, message: string) {
    super(message);
    this.problem = problem;
    this.name = "BackendModuleError";
  }
}

export interface BackendModuleInfo {
  /** The schema text, read without running the module. */
  typeDefs: string;
  imports: string[];
}

/** Shape of src/backend/af-module.ts (static reading; may use esbuild to strip types). */
export interface BackendModuleReader {
  /** Throws BackendModuleError. */
  readBackendModule(source: string): Promise<BackendModuleInfo>;
}

export interface LinkedBackend {
  name: string;
  id: FileId;
  version: string;
  typeDefs: string;
}
/** GET /api/files/:id/backends. Every viewer who can open the page can call its backends. */
export interface BackendsResponse {
  backends: LinkedBackend[];
}

/**
 * Port brief B's publish/save calls (src/backend/af-files.ts).
 * compile() runs outside the database transaction; record() runs inside it
 * with B's SqlClient so the page version and its backend versions commit together.
 */
export interface BackendFilesPort {
  /** Throws BackendModuleError or BackendHostError naming nothing secret; B maps it to 422 with the ID. */
  compile(
    files: Readonly<Record<FileId, string>>,
    signal?: AbortSignal,
  ): Promise<Record<FileId, CompiledBackend>>;
  /** Version rows for compiled files and the page version's links. */
  record(
    client: SqlClient,
    input: {
      owner: string;
      pageId: FileId;
      pageVersion: number;
      links: readonly BackendLink[];
      compiled: Readonly<Record<FileId, CompiledBackend>>;
    },
  ): Promise<void>;
  /** IDs among `ids` that are published backend files owned by `owner`. */
  owned(
    client: SqlClient,
    owner: string,
    ids: readonly FileId[],
  ): Promise<FileId[]>;
  /** IDs among `ids` that are published backend files (any owner). */
  published(client: SqlClient, ids: readonly FileId[]): Promise<FileId[]>;
  /** A published backend file's owner and current version, or null; serves /af/v1/ids/<backend-id> to its owner. */
  head(
    client: SqlClient,
    id: FileId,
  ): Promise<{ owner: string; version: string } | null>;
  /** Drop a deleted page's link rows; the backend files it linked stay published. Runs inside B's delete transaction. */
  forgetPage(client: SqlClient, pageId: FileId): Promise<void>;
}

/**
 * Largest store document, in bytes of JSON. Capability requests and results
 * cross the isolate in frames of at most 64 KiB, so the document stays under that.
 */
export const BACKEND_STORE_LIMIT_BYTES = 60 * 1024;

/**
 * The platform-kept store behind `caps.store` (src/backend/af-store.ts): one
 * JSON document per backend file, shared by every page and viewer that calls
 * the file's resolvers, with compare-and-swap on a version.
 */
export interface BackendStore {
  /** The file's document and version; `{ value: null, version: 0 }` when never written. */
  get(fileId: FileId): Promise<import("./contracts.ts").BackendStoreDocument>;
  /**
   * Replace the document if its version is still `expected`. Resolves with the
   * new version, or `{ conflict: true, version }` with the current version.
   * Rejects (TypeError) for a value over BACKEND_STORE_LIMIT_BYTES or a bad `expected`.
   */
  set(
    fileId: FileId,
    value: import("./contracts.ts").BackendJson,
    expected: number,
  ): Promise<import("./contracts.ts").BackendStoreWrite>;
  /** The capability handler for one backend file: answers store requests, refuses everything else. */
  handler(fileId: FileId): import("./contracts.ts").BackendCapabilityHandler;
}

/** Tables brief C owns. Brief B's bootstrap runs this file after its own schema. */
export const BACKEND_SCHEMA_FILE = "src/backend/af-schema.sql";

/** Shape of src/backend/af-files.ts. */
export interface BackendFilesModule {
  createBackendFiles(options: {
    host?: import("./contracts.ts").BackendHost;
  }): BackendFilesPort;
  /** Handles GET …/backends and POST …/graphql. */
  createBackendRoutes(options: {
    database: SqlDatabase;
    host?: import("./contracts.ts").BackendHost;
    /**
     * The backend file owner's secrets for a call's `env` (the file's owner
     * from af_backend_files, never the page's or the caller's), read in the
     * request's own short transaction. Without it every call gets `{}`.
     */
    secrets?: import("../server/secrets-contracts.ts").SecretsEnvPort;
    /** Explicit server binding service; absent means every dataset capability is denied. */
    datasets?: import("../datasets/contracts.ts").DatasetReadService;
    datasetMutations?: import("../datasets/mutation/contracts.ts").DatasetMutationService;
    /** B's resolver from credential to caller, so C never parses tokens itself. */
    caller(
      client: SqlClient,
      pageId: FileId,
      credential: string,
    ): Promise<import("../graphql/af-namespace-contracts.ts").PageCaller>;
    /**
     * One line per failed backend call and per runtime upgrade: page ID,
     * backend ID, field and code; never source or stderr. Defaults to console.error.
     */
    log?(line: string): void;
  }): AfRouteModule;
}
