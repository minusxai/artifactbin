/**
 * @artifactbin/contracts is entered by topic: each file here is its own entry (`@artifactbin/contracts/<file>`, the
 * package's `./*` export), so a caller names the one contract it speaks. This root entry keeps only the names the
 * private deployment imports from it (__tests__/downstream-exports.test.ts) while it moves to the topic entries.
 */
export { ACTOR_HEADER, ANONYMOUS, HUMAN_SESSION_LIVE_PATH, type Actor } from './actor';
export { ARTIFACT_ID_PATTERN } from './artifact-reference';
export { BUILD_ASSET_PATH } from './build-assets';
export { CONNECTORS, CONNECTOR_ERROR_CODES, CONNECTOR_LIMITS, CONNECTOR_VALUE_TYPES, type Connection, type ConnectionConfig, type ConnectionSummary, type ConnectorAnswer, type ConnectorColumn, type ConnectorDialect, type ConnectorError, type ConnectorErrorCode, type ConnectorField, type ConnectorFieldKind, type ConnectorId, type ConnectorJson, type ConnectorLimits, type ConnectorNetworkPolicy, type ConnectorQuery, type ConnectorScalar, type ConnectorSchema, type ConnectorSchemaTable, type ConnectorSpec, type ConnectorTestResult, type ConnectorValueType, type ConnectorViewer } from './connectors';
export type { DatasetPolicy } from './dataset-policy';
export type { Queryable } from './db';
export { COMMENT_CHANGES_MAX_WAIT_SECONDS, EVENT_FEED_MAX_WAIT_SECONDS } from './event-feed';
export { eventName, type EventEnvelope, type EventPayload, type EventVerb, type EventsService, type ObjectKind } from './events';
export { IDENTITY_CALL_PATH, IDENTITY_OWNED_TABLES, type TransactionalQueryable } from './identity-module';
export { IDENTITY_INTROSPECT_PATH } from './identity-service';
export type { TokenReader, TokenRecord } from './identity';
export type { Part, Upstream } from './part';
export { FORWARDED_HOST, FORWARDED_PROTO, SERVICE_AUTH_HEADER } from './routes';
export { isQueryFailure, type MutationInput, type MutationOutcome, type SqlService } from './sql';
export { isTestDomainEmail } from './test-domain';
export { URL_SPACE, URL_SPACE_PATH, classifyPath, documentHostServes, emailLinkPath, isAppBuildPath, isScreenPath, ownerHostServes, personLinkPath, type PathKind } from './url-space';
