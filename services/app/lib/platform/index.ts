/**
 * The platform module's interface: the infrastructure every product module stands on (configuration, the
 * database and its schema, identifiers, the event log and its outbox, the request scope, the injected services,
 * and query statistics). Product code outside lib/platform enters only here
 * (DEEP_MODULES in scripts/ci/module-graph.mjs); config.ts, db.ts and services.ts keep their paths because a
 * downstream deployment imports them directly (__tests__/downstream-exports.test.ts). Tests also use ./testing.
 */
export {
  ALIAS_ORIGINS, ALLOW_PUBLIC_VISIBILITY, ANALYTICS_SECRET, APP_HMR_PORT_SETTING, ARTIFACT_QUOTA_PER_TOKEN, ASSETS_MAX_BYTES_PER_TOKEN,
  ASSETS_ORIGIN, AUTH_SERVICE_URL, AUTH_SECRET, BROWSER_SERVICE_URL, USER_PAGES_HOST, DATABASE_URL,
  EVENTS_SCHEMA, EVENTS_SERVICE_URL, EXPORT_INTERNAL_ORIGIN, INTERNAL_SERVICE_SECRET, IS_DEV, LOCAL_OBJECT_DIR,
  MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_ROWS_LIMIT, OUTBOUND_IPS, PUBLIC_BASE_URL, QUERY_TIMEOUT_MS, SQL_READ_WALL_TIMEOUT_MS, SQL_MUTATION_TIMEOUT_MS,
  S3_URL, SQL_SERVICE_URL, TEST_DOMAIN, TRUSTED_PROXY_HOPS, WEB_INGEST_ALLOW_PRIVATE, WEB_INGEST_MAX_PER_HOUR, WEB_INGEST_TIMEOUT_MS,
  deploymentConfig, loginLink, env, envNamesRead, registerTestOverride, requirePagesHost,
  resolveHmrPort, unknownEnvNames, serviceAudiences, embedTrustedOrigins, shellFile, skillExtrasDir, designSystemDir, defaultDesignSystemName,
} from './config';
export { datasetsAllowPrivateNetwork, defaultConnectionSetting, groupScopedConnections } from './config';
export { getDb } from './db';
export type { Db, Queryable } from './db';
export { actorSubject, emit, envelope } from './events';
export type { EventSubject } from './events';
export { groupTrustApprovalsEnabled } from './config';
export { datasetsOwnConnections } from './config';
export { enqueueEvent, enqueueEvents, publishEventOutbox, recordEvent, setEventProjection, startEventPublisher } from './event-outbox';
export { ID_RE, generateFileId, generateInternalId } from './ids';
export { currentHeaders, currentRequest, runWithRequest } from './request-context';
export { measureQueries } from './query-stats';
export { retryOnConflict, TransactionConflict } from './conflict-retry';
export { TABLES, TITLE_SLUG_SQL } from './schema';
export { services, setServices } from './services';
export { lockSubjects } from './advisory-locks';
export { datasetConnectionCipher } from './secret-cipher';
export { ensureLocalIdentity } from './identity-host';
export type { Services } from './services';
