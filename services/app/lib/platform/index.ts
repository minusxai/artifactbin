/**
 * The platform module's interface: the infrastructure every product module stands on (configuration, the
 * database and its schema, identifiers, the event log and its outbox, the request scope, the injected services,
 * and query statistics). Code outside lib/platform enters only here
 * (DEEP_MODULES in scripts/ci/module-graph.mjs); config.ts, db.ts and services.ts keep their paths because a
 * downstream deployment imports them directly (__tests__/downstream-exports.test.ts).
 */
export {
  ALIAS_ORIGINS, ALLOW_PUBLIC_VISIBILITY, ANALYTICS_SECRET, APP_HMR_PORT_SETTING, ARTIFACT_QUOTA_PER_TOKEN, ASSETS_MAX_BYTES_PER_TOKEN,
  ASSETS_ORIGIN, AUTH_SERVICE_URL, AUTH_SECRET, BROWSER_SERVICE_URL, USER_PAGES_HOST, DATABASE_URL,
  EVENTS_SCHEMA, EVENTS_SERVICE_URL, EXPORT_INTERNAL_ORIGIN, INTERNAL_SERVICE_SECRET, IS_DEV, IS_TEST, LOCAL_OBJECT_DIR,
  MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_QUERY_ROWS, MAX_ROWS_LIMIT, OUTBOUND_IPS, PUBLIC_BASE_URL, QUERY_TIMEOUT_MS, RUNNER_SERVICE_URL,
  S3_URL, SQL_SERVICE_URL, TEST_DOMAIN, TRUSTED_PROXY_HOPS, WEB_INGEST_ALLOW_PRIVATE, WEB_INGEST_MAX_PER_HOUR, WEB_INGEST_TIMEOUT_MS,
  deploymentConfig, env, envNamesRead, functionScheduleMinimumMinutes, parseUserPagesHost, requirePagesHost,
  resolveHmrPort, unknownEnvNames, serviceAudiences, dataServices, pageSchedulesEnabled, embedTrustedOrigins, shellFile, skillExtrasDir,
} from './config';
export { PostgresDb, databaseTargetForRuntime, getDb, parseDatabaseUrl, resetDb, schemaImageInputs, schemaImageKey } from './db';
export type { Db, Queryable, SchemaImageInputs } from './db';
export { actorSubject, emit, envelope } from './events';
export type { EventSubject } from './events';
export { groupTrustApprovalsEnabled } from './config';
export { enqueueEvent, enqueueEvents, publishEventOutbox, recordEvent, setEventProjection, startEventPublisher } from './event-outbox';
export { FILE_ID_LENGTH, ID_RE, generateFileId, generateInternalId, generateTokenId } from './ids';
export { currentHeaders, currentRequest, overrideRequestHeaders, runWithRequest } from './request-context';
export { measureQueries } from './query-stats';
export { isTransactionConflict, retryOnConflict, TransactionConflict, type ConflictRetry } from './conflict-retry';
export { SCHEMA_STATEMENTS, TABLES, TITLE_SLUG_SQL } from './schema';
export { identityIsLocal, services, setServices } from './services';
export { lockSubjects } from './advisory-locks';
export { ensureLocalIdentity, syncIdentitySettings } from './identity-host';
export type { Services } from './services';
