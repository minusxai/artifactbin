import type {
  ColumnType,
  DatasetColumn,
  Row,
  RunInput,
  Scalar,
  QueryOutcome,
} from "@artifactbin/contracts";
/** Host-only identity from the saved page/backend, never from GraphQL arguments. */
export interface QueryIdentity {
  pageId: string;
  pageVersion: number;
  backendId: string;
  backendVersion: string;
  sourceSha256: string;
}
export interface QueryContext extends QueryIdentity {
  subject: string | null;
}
export interface QueryPlan {
  registration: QueryIdentity;
  scalars: Record<string, { type: ColumnType; default: Scalar }>;
  queries: readonly {
    name: string;
    sql: string;
    dependencies: readonly string[];
  }[];
  /** Server-owned bindings resolve CURRENT data, through original document reach and viewer row grants.
   * They are not raw-dataset readership grants and must never be returned to the page. */
  imports: readonly { alias: string; binding: string; table: string }[];
}
export interface QueryRequest {
  values: Record<string, Scalar>;
  only: string[];
}
interface QueryWindow {
  revision: string;
  authority: string;
  columns: DatasetColumn[];
  rows: Row[];
  nextOffset: number | null;
}
export interface QuerySource {
  read(
    offset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<QueryWindow>;
  /** Rechecks live dataset revision, document reach, viewer grants and policy after execution. */
  verify(signal: AbortSignal): Promise<void>;
}
/** Owned async execution; cancelAndDrain MUST settle only when work no longer holds resources.
 * The service does not race an uncancellable SQL call and abandon it. */
interface QueryExecution {
  result: Promise<Record<string, QueryOutcome>>;
  cancelAndDrain(reason: unknown): Promise<void>;
}
export interface QueryPorts {
  registry(
    context: Readonly<QueryContext>,
    signal: AbortSignal,
  ): Promise<QueryPlan | null>;
  authorize(
    context: Readonly<QueryContext>,
    identity: Readonly<QueryIdentity>,
    signal: AbortSignal,
  ): Promise<boolean>;
  platform(
    context: Readonly<QueryContext>,
    signal: AbortSignal,
  ): Promise<{ userId: string | null; now: string; tz: string }>;
  /** Source selection must preserve result-only document authority, with viewer filtering, not require raw-read permission. */
  source(
    context: Readonly<QueryContext>,
    binding: Readonly<QueryPlan["imports"][number]>,
    signal: AbortSignal,
  ): Promise<QuerySource>;
  /** Composition root adapts the CURRENT host SqlService. SQL is exclusively from the immutable registry. */
  execute(input: RunInput, signal: AbortSignal): QueryExecution;
}
export interface QueryOptions {
  scheduleDeadline?: (ms: number, expire: () => void) => () => void;
}
export const QUERY_LIMITS = Object.freeze({
  rows: 10000,
  cells: 1000000,
  tables: 64,
  queries: 64,
  params: 240,
  sqlBytes: 64000,
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 1024 * 1024,
  wallMs: 20000,
});
