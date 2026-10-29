/**
 * The platform module's interface: the infrastructure every product module stands on (configuration, the
 * database and its schema, identifiers, the event log and its outbox, the request scope, the injected services,
 * query statistics and client identity). Code outside lib/platform enters only here
 * (DEEP_MODULES in scripts/ci/module-graph.mjs); config.ts, db.ts and services.ts keep their paths because a
 * downstream deployment imports them directly (__tests__/downstream-exports.test.ts).
 */
export { ARTIFACTBIN_AGENT_HEADER, describeClient, forwardedFor, identifyClient, logClientIdentity } from './client-identity';
export type { Harness } from './client-identity';
export {
  ALIAS_ORIGINS, ALLOW_PUBLIC_VISIBILITY, ANALYTICS_SECRET, APP_HMR_PORT_SETTING, ARTIFACT_QUOTA_PER_TOKEN, ASSETS_MAX_BYTES_PER_TOKEN,
  ASSETS_ORIGIN, AUTH_SECRET, BROWSER_SERVICE_URL, CUSTOM_DOMAINS_TARGET, DATABASE_URL, DATASET_ALLOW_PRIVATE_NETWORKS, DATASET_DNS_SERVERS,
  DATASET_PRIVATE_TARGET_HASHES, EVENTS_SCHEMA, EVENTS_SERVICE_URL, EXPORT_INTERNAL_ORIGIN, INTERNAL_SERVICE_SECRET, IS_DEV, LOCAL_OBJECT_DIR,
  MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_QUERY_ROWS, MAX_ROWS_LIMIT, PUBLIC_BASE_URL, QUERY_TIMEOUT_MS, RUNNER_SERVICE_URL,
  S3_URL, SQL_SERVICE_URL, TEST_DOMAIN, TRUSTED_PROXY_HOPS, WEB_INGEST_ALLOW_PRIVATE, WEB_INGEST_MAX_PER_HOUR, WEB_INGEST_TIMEOUT_MS,
  advertisedCliVersion, cliRetirementEnabled, deploymentConfig, env, envNamesRead, parseCustomDomainsTarget, requirePagesHost,
  resolveHmrPort, unknownEnvNames,
} from './config';
export { PostgresDb, databaseTargetForRuntime, getDb, parseDatabaseUrl, resetDb } from './db';
export type { Db, Queryable } from './db';
export { actorSubject, emit, envelope } from './events';
export type { EventSubject } from './events';
export { enqueueEvent, enqueueEvents, recordEvent, setEventProjection, startEventPublisher } from './event-outbox';
export { FILE_ID_LENGTH, ID_RE, generateFileId, generateInternalId, generateTokenId } from './ids';
export { currentHeaders, currentRequest, overrideRequestHeaders, runWithRequest } from './request-context';
export { measureQueries } from './query-stats';
export { SCHEMA_STATEMENTS, TABLES } from './schema';
export { services, setServices } from './services';
export type { Services } from './services';
