/**
 * trackEvent dual-writes: the analytics_events row it always wrote, AND one
 * sentence to services().events. The mapping is the one the view migration
 * relies on — a VIEW's subject is always the daily visitor hash (the user id
 * rides in the payload), any other verb's subject is the user when known;
 * `fork` is recorded against the ORIGINAL with the copy as `fork_id`; and
 * `sse_connect` is not a moment anyone cares about, so it emits nothing.
 *
 * Seeded RED by the orchestrator.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { useAppHarness } from '@/__tests__/harness';
import { trackEvent } from '@/lib/analytics';
import { setServices } from '@/lib/services';

const harness = useAppHarness();

// A request carrying a user-agent, so the visitor hash exists (lib/analytics reads it off the request context).
const requestHeaders = new Map<string, string>([['user-agent', 'Mozilla/5.0 (test)']]);
vi.mock('@/lib/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-context')>()),
  currentHeaders: async () => (requestHeaders.size === 0 ? null : { get: (k: string) => requestHeaders.get(k.toLowerCase()) ?? null }),
}));

let fake: FakeEvents;
beforeEach(() => { fake = fakeEvents(); setServices({ events: fake }); });
const analyticsRows = async () => (await (await harness.db()).query<{ n: number }>('SELECT count(*)::int AS n FROM analytics_events')).rows[0]!.n;

describe('trackEvent dual-write', () => {
  it('a view: the analytics row as before, plus artifact.viewed whose subject is the visitor hash even when signed in', async () => {
    await trackEvent('view', 'abc123', { userId: 'usr_x' });
    expect(await analyticsRows()).toBe(1);
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ source: 'app', verb: 'viewed', object_kind: 'artifact', object_id: 'abc123', subject_kind: 'visitor', payload: { user_id: 'usr_x' } });
    expect(fake.events[0]!.subject_id).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof fake.events[0]!.payload.client).toBe('string');
  });
  it('a fork: recorded against the ORIGINAL, the user as subject, the copy in the payload', async () => {
    await trackEvent('fork', 'abc123', { userId: 'usr_x', forkId: 'xyz789' });
    expect(fake.events[0]).toMatchObject({ verb: 'forked', object_id: 'abc123', subject_kind: 'user', subject_id: 'usr_x', payload: { fork_id: 'xyz789', user_id: 'usr_x' } });
  });
  it('the other verbs map one to one; sse_connect emits nothing', async () => {
    for (const [event, verb] of [['create', 'created'], ['update', 'updated'], ['edit', 'edited'], ['mutate', 'mutated'], ['revert', 'reverted'], ['export', 'exported'], ['delete', 'deleted']] as const) {
      await trackEvent(event, 'abc123', { userId: 'usr_x' });
      expect(fake.events.at(-1)?.verb).toBe(verb);
    }
    const n = fake.events.length;
    await trackEvent('sse_connect', 'abc123');
    expect(fake.events).toHaveLength(n);
    expect(await analyticsRows()).toBe(8);
  });
  it('an anonymous, off-request write has a null subject and still lands', async () => {
    requestHeaders.clear();
    try {
      await trackEvent('create', 'abc123');
      expect(fake.events[0]).toMatchObject({ verb: 'created', subject_kind: null, subject_id: null });
    } finally {
      requestHeaders.set('user-agent', 'Mozilla/5.0 (test)');
    }
  });
  it('a failing events service never fails the caller and never loses the analytics row', async () => {
    fake.fail = new Error('down');
    await expect(trackEvent('view', 'abc123')).resolves.toBeUndefined();
    expect(await analyticsRows()).toBe(1);
  });
});
