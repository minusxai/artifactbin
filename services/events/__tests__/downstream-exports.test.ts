/**
 * WHAT THE DEPLOYMENT IMPORTS FROM @artifactbin/events. The private server repository
 * (minusxai/artifactbin-server) composes its events service from these names; removing one breaks that build,
 * which no other check here sees. Named imports, so knip's entry-export check (knip.config.js
 * `includeEntryExports`) counts them as used and refuses every other unused export. Regenerated from
 * artifactbin-server f1741b6 on 2026-11-03: change a line only together with that repository.
 */
import { expect, expectTypeOf, it } from 'vitest';
import { eventName, eventsClient, eventsPool, loadEventsConfig, runEvents, serveEvents, type EventEnvelope, type EventSink, type Queryable } from '@artifactbin/events';

it('exports the values the deployment imports', () => {
  const values = { eventName, eventsClient, eventsPool, loadEventsConfig, runEvents, serveEvents };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<[EventEnvelope, EventSink, Queryable]>().not.toBeNever();
});
