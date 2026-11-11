/**
 * WHAT THE DEPLOYMENT IMPORTS FROM @artifactbin/contracts. The private server repository
 * (minusxai/artifactbin-server) composes the product from these names; removing one breaks that build, which no
 * other check here sees. Named imports, so knip's entry-export check (knip.config.js `includeEntryExports`)
 * counts them as used and refuses every other unused export. Regenerated from artifactbin-server f1741b6 and
 * artifactbin-evals 9c5618b on 2026-11-03: change a line only together with that repository.
 */
import { expect, expectTypeOf, it } from 'vitest';
import {
  ACTOR_HEADER, ANONYMOUS, ARTIFACT_ID_PATTERN, COMMENT_CHANGES_MAX_WAIT_SECONDS, EVENT_FEED_MAX_WAIT_SECONDS, FORWARDED_HOST, FORWARDED_PROTO,
  HUMAN_SESSION_LIVE_PATH, IDENTITY_CALL_PATH, IDENTITY_INTROSPECT_PATH, RESOLVER_LIMITS, SERVICE_AUTH_HEADER, eventName, isQueryFailure,
  type Actor, type DatasetPolicy, type EventEnvelope, type EventPayload, type EventVerb, type EventsService,
  type MutationInput, type MutationOutcome, type ObjectKind, type Part, type Queryable, type RunSnapshot, type RunStart,
  type RunnerService, type SqlService, type TokenReader, type TokenRecord, type Upstream,
} from '@artifactbin/contracts';
// The URL map the deployment's proxy (and any co-hosted router) reads instead of keeping its own path lists:
// the classifier, the host allowlists, the legacy table and the e-mail link builder its mail extension writes.
import {
  URL_SPACE, URL_SPACE_PATH, classifyPath, documentHostServes, ownerHostServes, isAppBuildPath, canonicalPublicPath,
  LEGACY_PUBLIC_PATHS, emailLinkPath, personLinkPath, isScreenPath, type PathKind,
} from '@artifactbin/contracts';

it('exports the values the deployment imports', () => {
  const values = { ACTOR_HEADER, ANONYMOUS, ARTIFACT_ID_PATTERN, COMMENT_CHANGES_MAX_WAIT_SECONDS, EVENT_FEED_MAX_WAIT_SECONDS, FORWARDED_HOST, FORWARDED_PROTO, HUMAN_SESSION_LIVE_PATH, IDENTITY_CALL_PATH, IDENTITY_INTROSPECT_PATH, RESOLVER_LIMITS, SERVICE_AUTH_HEADER, eventName, isQueryFailure };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the URL map the deployment classifies paths with', () => {
  for (const [name, value] of Object.entries({ URL_SPACE, URL_SPACE_PATH, classifyPath, documentHostServes, ownerHostServes, isAppBuildPath, canonicalPublicPath, LEGACY_PUBLIC_PATHS, emailLinkPath, personLinkPath, isScreenPath })) expect(value, name).toBeDefined();
  expect(URL_SPACE_PATH).toBe('/af/url-space.json');
  expect(emailLinkPath('d1')).toBe('/api/email/d1');
  expect(classifyPath('/email/d1')).toBe('legacy');
  expectTypeOf<PathKind>().not.toBeNever();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<[Actor, DatasetPolicy, EventEnvelope, EventPayload<'artifact', 'created'>, EventVerb<'artifact'>, EventsService, MutationInput, MutationOutcome, ObjectKind, Part, Queryable, RunSnapshot, RunStart, RunnerService, SqlService, TokenReader, TokenRecord, Upstream]>().not.toBeNever();
});

// The connector contract (./src/connectors.ts) a deployment's own data endpoint and the live-dataset screens build on.
import {
  CONNECTORS, CONNECTOR_ERROR_CODES, CONNECTOR_LIMITS, CONNECTOR_VALUE_TYPES,
  type Connection, type ConnectionConfig, type ConnectionSummary, type ConnectorAnswer, type ConnectorColumn, type ConnectorError,
  type ConnectorErrorCode, type ConnectorField, type ConnectorId, type ConnectorNetworkPolicy, type ConnectorQuery, type ConnectorSchema,
  type ConnectorSpec, type ConnectorTestResult, type ConnectorValueType, type ConnectorViewer, type ConnectorFieldKind, type ConnectorDialect,
  type ConnectorScalar, type ConnectorJson, type ConnectorLimits, type ConnectorSchemaTable,
} from '@artifactbin/contracts';

it('exports the connector contract', () => {
  expect(CONNECTORS.map((c) => c.id)).toEqual(['postgres', 'mysql', 'bigquery']);
  expect(CONNECTOR_VALUE_TYPES).toEqual(['text', 'number', 'boolean', 'date', 'timestamp', 'json']);
  for (const c of CONNECTORS) for (const f of c.fields) expect(f.secret && f.shown, `${c.id}.${f.name}`).toBe(false);
  expect(CONNECTOR_ERROR_CODES).toContain('read_only');
  expect(CONNECTOR_LIMITS.rows).toBeGreaterThan(0);
  expectTypeOf<[Connection, ConnectionConfig, ConnectionSummary, ConnectorAnswer, ConnectorColumn, ConnectorError, ConnectorErrorCode, ConnectorField, ConnectorId, ConnectorNetworkPolicy, ConnectorQuery, ConnectorSchema, ConnectorSpec, ConnectorTestResult, ConnectorValueType, ConnectorViewer, ConnectorFieldKind, ConnectorDialect, ConnectorScalar, ConnectorJson, ConnectorLimits, ConnectorSchemaTable]>().not.toBeNever();
});
