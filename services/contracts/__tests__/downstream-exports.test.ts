/**
 * WHAT THE DEPLOYMENT IMPORTS FROM @artifactbin/contracts. The private server repository
 * (minusxai/artifactbin-server) composes the product from these names; removing one breaks that build, which no
 * other check here sees. Named imports, so knip's entry-export check (knip.config.js `includeEntryExports`)
 * counts them as used and refuses every other unused export. Regenerated from artifactbin-server f1741b6 and
 * artifactbin-evals 9c5618b on 2026-11-03, and from artifactbin-server f2063bd on 2026-11-20: change a line only
 * together with that repository.
 */
import { expect, it } from 'vitest';
// The root entry: the seam every service shares (the actor, the part and its upstream, the database, the forwarded
// and service headers). Everything else is imported by topic.
import { ACTOR_HEADER, ANONYMOUS, FORWARDED_HOST, FORWARDED_PROTO, HUMAN_SESSION_LIVE_PATH, SERVICE_AUTH_HEADER } from '@artifactbin/contracts';
import { ACTOR_HEADER as actorHeader, ANONYMOUS as anonymous } from '@artifactbin/contracts/actor';
import { FORWARDED_HOST as forwardedHost, FORWARDED_PROTO as forwardedProto, HUMAN_SESSION_LIVE_PATH as humanSessionLivePath, SERVICE_AUTH_HEADER as serviceAuthHeader } from '@artifactbin/contracts/routes';
import { idFromPagesLabel, isOwnerTitlePath, ownerDocumentDoor, ownerFolderId, ownerHandleFromLabel, ownerHostConflicts, ownerSiteAddress, ownerSqlArtifactId, parseDnsHostname } from '@artifactbin/contracts/owner-host';
import { CONNECTORS, CONNECTOR_ERROR_CODES, CONNECTOR_LIMITS, CONNECTOR_VALUE_TYPES } from '@artifactbin/contracts/connectors';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts/artifact-reference';
import { EVENT_FEED_MAX_WAIT_SECONDS } from '@artifactbin/contracts/event-feed';
import { IDENTITY_OWNED_TABLES } from '@artifactbin/contracts/identity-module';
import { IDENTITY_INTROSPECT_PATH } from '@artifactbin/contracts/identity-service';
import { eventName } from '@artifactbin/contracts/events';
import { isQueryFailure } from '@artifactbin/contracts/sql';
import { BUILD_ASSET_PATH } from '@artifactbin/contracts/build-assets';
import { isTestDomainEmail } from '@artifactbin/contracts/test-domain';

// The URL map the deployment's proxy (and any co-hosted router) reads instead of keeping its own path lists:
// the classifier, the host allowlists, the e-mail link builder its mail extension writes.
import { URL_SPACE_PATH, classifyPath, ownerHostServes, emailLinkPath, personLinkPath } from '@artifactbin/contracts/url-space';

it('exports the values the deployment imports', () => {
  const values = { ACTOR_HEADER, ANONYMOUS, ARTIFACT_ID_PATTERN, EVENT_FEED_MAX_WAIT_SECONDS, FORWARDED_HOST, FORWARDED_PROTO, HUMAN_SESSION_LIVE_PATH, IDENTITY_INTROSPECT_PATH, SERVICE_AUTH_HEADER, eventName, isQueryFailure, BUILD_ASSET_PATH, IDENTITY_OWNED_TABLES, isTestDomainEmail };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the shared seam by topic as well as from the root', () => {
  expect([actorHeader, anonymous, forwardedHost, forwardedProto, humanSessionLivePath, serviceAuthHeader])
    .toEqual([ACTOR_HEADER, ANONYMOUS, FORWARDED_HOST, FORWARDED_PROTO, HUMAN_SESSION_LIVE_PATH, SERVICE_AUTH_HEADER]);
});

it('exports the owner hostname and path classifiers by topic', () => {
  for (const [name, value] of Object.entries({ idFromPagesLabel, isOwnerTitlePath, ownerDocumentDoor, ownerFolderId, ownerHandleFromLabel, ownerHostConflicts, ownerSiteAddress, ownerSqlArtifactId, parseDnsHostname }))
    expect(value, name).toBeTypeOf('function');
});

it('exports the URL map the deployment classifies paths with', () => {
  for (const [name, value] of Object.entries({ URL_SPACE_PATH, classifyPath, ownerHostServes, emailLinkPath, personLinkPath })) expect(value, name).toBeDefined();
  expect(URL_SPACE_PATH).toBe('/af/url-space.json');
  expect(emailLinkPath('d1')).toBe('/api/email/d1');
  expect(classifyPath('/email/d1')).toBe('screen');
});

it('exports the connector contract', () => {
  expect(CONNECTORS.map((c) => c.id)).toEqual(['postgres', 'mysql', 'bigquery']);
  expect(CONNECTOR_VALUE_TYPES).toEqual(['text', 'number', 'boolean', 'date', 'timestamp', 'json']);
  for (const c of CONNECTORS) for (const f of c.fields) expect(f.secret && f.shown, `${c.id}.${f.name}`).toBe(false);
  expect(CONNECTOR_ERROR_CODES).toContain('read_only');
  expect(CONNECTOR_LIMITS.rows).toBeGreaterThan(0);
});
