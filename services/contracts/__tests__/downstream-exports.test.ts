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

it('exports the values the deployment imports', () => {
  const values = { ACTOR_HEADER, ANONYMOUS, ARTIFACT_ID_PATTERN, COMMENT_CHANGES_MAX_WAIT_SECONDS, EVENT_FEED_MAX_WAIT_SECONDS, FORWARDED_HOST, FORWARDED_PROTO, HUMAN_SESSION_LIVE_PATH, IDENTITY_CALL_PATH, IDENTITY_INTROSPECT_PATH, RESOLVER_LIMITS, SERVICE_AUTH_HEADER, eventName, isQueryFailure };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<[Actor, DatasetPolicy, EventEnvelope, EventPayload<'artifact', 'created'>, EventVerb<'artifact'>, EventsService, MutationInput, MutationOutcome, ObjectKind, Part, Queryable, RunSnapshot, RunStart, RunnerService, SqlService, TokenReader, TokenRecord, Upstream]>().not.toBeNever();
});
