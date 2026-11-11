/**
 * THE CONNECTOR CONTRACT: how Artifactbin reads a database in place. Types and constants only; the registry and the
 * drivers are `@artifactbin/connectors` (server-only), which is the one implementation of `Connection`.
 *
 * CONFIGURATION is ONE JSON object, `{"connector": "<id>", ...that connector's fields}`. The same object is what a
 * live dataset stores (its `secret` fields encrypted at rest and never returned by any API) and what the install's
 * default connection setting (`DATASETS__DEFAULT_CONNECTION`) holds. Each connector declares its fields in
 * `CONNECTORS`; a field not declared there is refused, so a typo never reads as a setting.
 *
 * A QUERY is the database's own SQL dialect, passed through, with NAMED bound parameters (`$name` in the text,
 * the value in `params`; never spliced into the text): one statement, run read-only, on exactly one connection.
 * The answer is columns in a small common type set and rows of JSON values, within `CONNECTOR_LIMITS` (rows, bytes,
 * time); past the row limit the rows stop and `truncated` is set. A failure is one shape, `ConnectorError`: a code
 * from `CONNECTOR_ERROR_CODES` and a one-line message that never carries a secret.
 *
 * THE VIEWER. Every query carries the person it runs for (`viewer`, null for nobody) as metadata, apart from the SQL and
 * from the connection's one credential: `viewer_id`, `viewer_email` and `viewer_groups` (the IDs of the groups they
 * belong to, as JSON array text, sorted: `["g1","g2"]`). The database protocols have no per-query metadata, so the
 * connector sets them on the session immediately before each statement, inside that statement's own read-only
 * transaction, every time (a pooled session never carries another person's values): Postgres
 * `set_config('app.viewer_id' | 'app.viewer_email' | 'app.viewer_groups', value, true)`, MySQL the session variables
 * `@app_viewer_id` / `@app_viewer_email` / `@app_viewer_groups` (reset to NULL when the session is returned). Nobody:
 * empty strings and `[]`. A database that relies on them must read them as the statement starts and ignore changes a
 * statement makes itself, which a gateway built for this does; a plain database cannot guarantee that, so there they
 * are ADVISORY whenever the reader writes the SQL (other databases, maybe in future).
 */
import { SQL_READ_LIMITS } from './sql';

/** The common column types every connector maps its database's types to. Anything unknown is `text`. */
export const CONNECTOR_VALUE_TYPES = ['text', 'number', 'boolean', 'date', 'timestamp', 'json'] as const;
export type ConnectorValueType = (typeof CONNECTOR_VALUE_TYPES)[number];

/**
 * How a configuration field is entered and checked: `string` one line, `integer` a whole number, `choice` one of
 * `choices`, `pem` a PEM certificate bundle, `json` a JSON document (a service-account key).
 */
export type ConnectorFieldKind = 'string' | 'integer' | 'choice' | 'pem' | 'json';
export interface ConnectorField {
  readonly name: string;
  readonly label: string;
  readonly kind: ConnectorFieldKind;
  readonly required: boolean;
  /** Stored encrypted, never returned by any API, never logged, removed from every error message. */
  readonly secret: boolean;
  /** Safe to show people who may use the connection (the settings page's host, say). Never true for a secret. */
  readonly shown: boolean;
  readonly default?: string | number;
  readonly choices?: readonly string[];
  readonly description: string;
}

export type ConnectorId = 'postgres' | 'mysql' | 'bigquery';
/** The SQL a connector's queries are written in; the statement text is passed through in it, never translated. */
export type ConnectorDialect = 'postgres' | 'mysql' | 'bigquery';
export interface ConnectorSpec {
  readonly id: ConnectorId;
  readonly label: string;
  /** Where the person choosing a source finds it: `live` connectors query a database in place. */
  readonly group: 'live';
  readonly dialect: ConnectorDialect;
  /** One line for people and agents: what it connects to. */
  readonly summary: string;
  /**
   * What the text after `default:` in a page's link (and an agent's `default:<name>`) selects on this connector:
   * the schema, database or dataset unqualified table names resolve in. Empty: the connection's own default.
   */
  readonly namespace: string;
  readonly fields: readonly ConnectorField[];
}

const host: ConnectorField = { name: 'host', label: 'Host', kind: 'string', required: true, secret: false, shown: true, description: 'The database server\'s public host name or address.' };
const user: ConnectorField = { name: 'user', label: 'User', kind: 'string', required: true, secret: false, shown: false, description: 'The account Artifactbin signs in as; give it read-only grants.' };
const password: ConnectorField = { name: 'password', label: 'Password', kind: 'string', required: false, secret: true, shown: false, description: 'That account\'s password.' };
const tls: ConnectorField = { name: 'tls', label: 'TLS', kind: 'choice', required: false, secret: false, shown: false, default: 'verify-full', choices: ['verify-full', 'disable'], description: '`verify-full` checks the server\'s certificate and name; `disable` is refused unless the install allows private networks (development).' };
const ca: ConnectorField = { name: 'ca', label: 'CA certificate', kind: 'pem', required: false, secret: false, shown: false, description: 'The certificate authority the server\'s certificate chains to, when it is not a public one (RDS, Cloud SQL and Supabase need one).' };

/** THE REGISTRY, as data: every built-in connector and its fields. Adding a source adds one entry and one module. */
export const CONNECTORS: readonly ConnectorSpec[] = Object.freeze([
  {
    id: 'postgres', label: 'PostgreSQL', group: 'live', dialect: 'postgres',
    summary: 'PostgreSQL and servers speaking its protocol (Amazon RDS and Aurora, Cloud SQL, Supabase, Neon, CockroachDB, Redshift).',
    namespace: 'the schema (search_path) unqualified tables resolve in',
    fields: [host, { name: 'port', label: 'Port', kind: 'integer', required: false, secret: false, shown: true, default: 5432, description: 'The server\'s port.' },
      { name: 'database', label: 'Database', kind: 'string', required: true, secret: false, shown: true, description: 'The database to connect to.' }, user, password, tls, ca],
  },
  {
    id: 'mysql', label: 'MySQL', group: 'live', dialect: 'mysql',
    summary: 'MySQL and servers speaking its protocol (MariaDB, Amazon Aurora MySQL, PlanetScale, TiDB, SingleStore).',
    namespace: 'the database (USE) unqualified tables resolve in',
    fields: [host, { name: 'port', label: 'Port', kind: 'integer', required: false, secret: false, shown: true, default: 3306, description: 'The server\'s port.' },
      { name: 'database', label: 'Database', kind: 'string', required: true, secret: false, shown: true, description: 'The default database.' }, user, password, tls, ca],
  },
  {
    id: 'bigquery', label: 'BigQuery', group: 'live', dialect: 'bigquery',
    summary: 'Google BigQuery, signed in with a service account key.',
    namespace: 'the dataset unqualified tables resolve in',
    fields: [
      { name: 'project', label: 'Project', kind: 'string', required: true, secret: false, shown: true, description: 'The Google Cloud project queries run (and are billed) in.' },
      { name: 'location', label: 'Location', kind: 'string', required: false, secret: false, shown: true, description: 'The datasets\' location (US, EU, a region); empty lets BigQuery choose.' },
      { name: 'dataset', label: 'Default dataset', kind: 'string', required: false, secret: false, shown: true, description: 'The dataset unqualified table names resolve in.' },
      { name: 'credentials', label: 'Service account key', kind: 'json', required: true, secret: true, shown: false, description: 'The service account\'s JSON key; give the account the BigQuery Data Viewer and Job User roles.' },
    ],
  },
]);

/** A value a query binds, a configuration field holds, or a cell carries. */
export type ConnectorScalar = string | number | boolean | null;
export type ConnectorJson = ConnectorScalar | ConnectorJson[] | { [key: string]: ConnectorJson };
/** One connection's configuration: `connector` names the registry entry, the rest are its declared fields. */
export type ConnectionConfig = { readonly connector: ConnectorId } & { readonly [field: string]: ConnectorScalar };

/** What a person may be shown about a connection: its connector and its `shown` fields, never a secret. */
export interface ConnectionSummary {
  readonly connector: ConnectorId;
  readonly label: string;
  readonly fields: Readonly<Record<string, string | number>>;
}

export interface ConnectorLimits {
  /** Rows an answer carries; more stop the read and set `truncated`. */
  readonly rows: number;
  /** The answer's JSON size; past it the query fails `result_too_large`. */
  readonly bytes: number;
  /** One query's time on the database (its statement timeout) and on the wire. */
  readonly timeoutMs: number;
}
/**
 * The common limits (a query may lower them, never raise them) and the connection bounds: `sqlBytes` and `params`
 * per statement, `connectTimeoutMs` to open a session, at most `poolSize` sessions per connection, each closed after
 * `idleMs` unused.
 */
export const CONNECTOR_LIMITS = Object.freeze({
  rows: SQL_READ_LIMITS.rows,
  bytes: SQL_READ_LIMITS.outputBytes,
  timeoutMs: SQL_READ_LIMITS.timeoutMs,
  sqlBytes: SQL_READ_LIMITS.sqlBytes,
  params: SQL_READ_LIMITS.params,
  connectTimeoutMs: 10_000,
  poolSize: 8,
  idleMs: 30_000,
  /** Tables and views `schema()` lists, at most. */
  schemaTables: 2000,
});

/** The person a query runs for. `email` is null for an account without one; `groups` their group IDs. */
export interface ConnectorViewer { readonly id: string; readonly email: string | null; readonly groups: readonly string[] }

export interface ConnectorQuery {
  /** One statement in the connector's dialect; `$name` marks a bound parameter. */
  readonly text: string;
  /** Every `$name` the text uses, by name. A name the text uses without a value is `invalid_query`. */
  readonly params: Readonly<Record<string, ConnectorScalar>>;
  /** Who the query runs for (the session values above); null sets them empty. */
  readonly viewer: ConnectorViewer | null;
  /** The connector's namespace for this query (see `ConnectorSpec.namespace`); absent: the connection's default. */
  readonly namespace?: string;
  readonly limits?: Partial<ConnectorLimits>;
  readonly signal?: AbortSignal;
}

export interface ConnectorColumn { readonly name: string; readonly type: ConnectorValueType }
export interface ConnectorAnswer {
  readonly columns: readonly ConnectorColumn[];
  readonly rows: readonly Readonly<Record<string, ConnectorJson>>[];
  /** Set when more rows matched than `limits.rows`. */
  readonly truncated?: true;
}

export interface ConnectorSchemaTable {
  /** The schema, database or dataset it lives in. */
  readonly namespace: string;
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly columns: readonly ConnectorColumn[];
}
export interface ConnectorSchema {
  readonly tables: readonly ConnectorSchemaTable[];
  /** Set when there were more than `CONNECTOR_LIMITS.schemaTables`. */
  readonly truncated?: true;
}

/** Every reason a connector refuses or fails, the same for every connector. */
export const CONNECTOR_ERROR_CODES = [
  /** The configuration is not this connector's (unknown connector or field, a missing or malformed value). */
  'invalid_config',
  /** The statement or its parameters were refused before reaching the database. */
  'invalid_query',
  /** The host is not a public address (loopback, private, link-local, metadata) and the install does not allow it. */
  'forbidden_address',
  /** The configuration turns TLS off and the install does not allow it. */
  'tls_required',
  'tls_unsupported',
  'tls_untrusted_certificate',
  'tls_name_mismatch',
  /** The server could not be reached (DNS, refused, timed out connecting). */
  'connect_failed',
  /** The server refused the sign-in. */
  'auth_failed',
  /** The statement tried to write: sessions are read-only. */
  'read_only',
  'timeout',
  'result_too_large',
  /** The database refused the statement (its SQLSTATE and message, the secret removed). */
  'database_error',
  /** The connector is registered but this install cannot run it. */
  'unavailable',
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];
export interface ConnectorError { readonly code: ConnectorErrorCode; readonly message: string }

export type ConnectorTestResult = { readonly ok: true; readonly latencyMs: number } | { readonly ok: false; readonly error: ConnectorError };

/**
 * One configured connection: a bounded pool of read-only sessions. Every method rejects with an error carrying a
 * `ConnectorError` (`connectorError` in the module reads it back).
 */
export interface Connection {
  readonly connector: ConnectorId;
  readonly dialect: ConnectorDialect;
  query(query: ConnectorQuery): Promise<ConnectorAnswer>;
  /** Tables and views the signed-in account can read, in `namespace` (absent: every namespace it can read). */
  schema(options?: { namespace?: string; signal?: AbortSignal }): Promise<ConnectorSchema>;
  /** Opens a session and runs a trivial read; never throws. */
  test(): Promise<ConnectorTestResult>;
  close(): Promise<void>;
}

/**
 * Where a connection may reach. Off (the default), only public addresses over TLS; `allowPrivateNetwork` (an install's
 * explicit development setting, never a page's or a connection's) also admits loopback and private addresses and
 * `tls: 'disable'`. Link-local and cloud metadata addresses are refused either way.
 */
export interface ConnectorNetworkPolicy { readonly allowPrivateNetwork: boolean }
