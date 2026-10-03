/** The platform module's interface: only what other modules import. */
export { trackEvent } from './analytics';
export { ARTIFACTBIN_AGENT_HEADER, describeClient, forwardedFor, identifyClient, logClientIdentity } from './client-identity';
export type { Harness } from './client-identity';
export { ALIAS_ORIGINS, ASSETS_ORIGIN, AUTH_SECRET, CUSTOM_DOMAINS_TARGET, EVENTS_SCHEMA, INTERNAL_SERVICE_SECRET, LOCAL_OBJECT_DIR, MAX_QUERY_ROWS, MAX_ROWS_LIMIT, PUBLIC_BASE_URL, QUERY_TIMEOUT_MS, TRUSTED_PROXY_HOPS, WEB_INGEST_MAX_PER_HOUR, parseCustomDomainsTarget, resolveHmrPort } from './config';
export { PostgresDb, databaseTargetForRuntime, getDb, parseDatabaseUrl, resetDb } from './db';
export type { Db, Queryable } from './db';
export { emit, envelope } from './events';
export type { EventObject, EventSubject } from './events';
export { FILE_ID_LENGTH, ID_RE, generateFileId, generateInternalId, generateTokenId } from './ids';
export { runWithRequest } from './request-context';
export { SCHEMA_STATEMENTS } from './schema';
export { services, setServices } from './services';
export type { Services } from './services';
export { sha256Hex } from './sha256';
