/**
 * The emitter (lib/events.ts): the envelope it builds, the service it hands
 * it to, that it never rejects — and the catalogue, walked whole: every verb
 * of every object kind builds a valid envelope from a typed fixture (a verb
 * without a fixture is a compile error), and none of them carries an email
 * outside the identity verbs or anything that looks like content or a secret.
 *
 * Seeded RED by the orchestrator.
 */
import { describe, expect, it } from 'vitest';
import type { EventPayload, EventVerb, ObjectKind } from '@artifactbin/contracts';
import { EVENT_VERBS, eventName } from '@artifactbin/contracts';
import { fakeEvents } from '@artifactbin/utils';
import { emit, envelope } from '@/lib/events';
import { services, setServices } from '@/lib/services';

type Fixtures = { [K in ObjectKind]: { [V in EventVerb<K>]: EventPayload<K, V> } };
/** One payload per verb, the values an operator would want in a channel: ids and names, never content. */
const FIXTURES: Fixtures = {
  artifact: {
    created: { client: 'claude-code', user_id: 'usr_a' },
    updated: { client: 'claude-code', user_id: 'usr_a' },
    edited: { client: 'browser', user_id: 'usr_a' },
    reverted: { client: 'browser', user_id: 'usr_a' },
    deleted: { client: 'browser', user_id: 'usr_a' },
    exported: { client: 'browser', user_id: null },
    mutated: { client: 'browser', user_id: null },
    viewed: { client: 'browser', user_id: 'usr_a' },
    forked: { client: 'claude-code', user_id: 'usr_b', fork_id: 'xyz789' },
    annotated: { annotation_id: 'ann_1' },
    annotation_resolved: { annotation_id: 'ann_1' },
    annotation_deleted: { annotation_id: 'ann_1' },
    sharing_changed: { visibility: 'unlisted', link_role: 'viewer' },
    moved: { from_parent_id: null, to_parent_id: 'fld123' },
    trashed: { format: 'markup', subtree: 0 },
    restored: { landed_at_root: true },
    liked: {},
    unliked: {},
  },
  user: {
    signed_up: { email: 'someone@example.com' },
    login_sent: { email: 'someone@example.com' },
    login_verified: { email: 'someone@example.com' },
    oauth_linked: { provider: 'google' },
    followed: {},
    unfollowed: {},
  },
  token: { minted: { name: 'laptop' }, claimed: { name: 'laptop' }, revoked: { name: null } },
  door: { denied: { door: 'ANON_MINT' } },
  route: { failed: { status: 500, method: 'POST' } },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('envelope', () => {
  it('stamps a uuid, an ISO time and source app around the sentence, flat like the row', () => {
    const before = Date.now();
    const e = envelope({ kind: 'user', id: 'usr_a' }, 'forked', { kind: 'artifact', id: 'abc123' }, { fork_id: 'xyz789', user_id: 'usr_a' });
    expect(e.id).toMatch(UUID);
    expect(Date.parse(e.at)).toBeGreaterThanOrEqual(before - 1);
    expect(e).toMatchObject({ source: 'app', subject_kind: 'user', subject_id: 'usr_a', verb: 'forked', object_kind: 'artifact', object_id: 'abc123', payload: { fork_id: 'xyz789', user_id: 'usr_a' } });
    expect(eventName(e)).toBe('artifact.forked');
  });
  it('a null subject is two nulls, not a missing column', () => {
    const e = envelope(null, 'denied', { kind: 'door', id: 'ANON_MINT' }, { door: 'ANON_MINT' });
    expect(e.subject_kind).toBeNull();
    expect(e.subject_id).toBeNull();
  });
  it('two envelopes never share an id', () => {
    const a = envelope(null, 'viewed', { kind: 'artifact', id: 'a' }, {});
    const b = envelope(null, 'viewed', { kind: 'artifact', id: 'a' }, {});
    expect(a.id).not.toBe(b.id);
  });
});

/**
 * THE THREE PLACEMENT VERBS (folders + the trash). A folder is an artifact, so
 * they are ARTIFACT verbs and there is no second object kind: a `folder` kind
 * would fork every consumer of `object_kind.verb` for rows that live in one
 * table. `deleted` keeps its old meaning — erased for good — and is said by the
 * purge; a trash is `trashed`, and the two must never read as each other.
 */
describe('the placement verbs', () => {
  it('a move names both ends, either of which may be the root', () => {
    const e = envelope({ kind: 'user', id: 'usr_a' }, 'moved', { kind: 'artifact', id: 'abc123' }, { from_parent_id: 'fld111', to_parent_id: null });
    expect(eventName(e)).toBe('artifact.moved');
    expect(e.payload).toEqual({ from_parent_id: 'fld111', to_parent_id: null });
  });
  it('a trash carries what went with it — 0 for a document, the subtree size for a folder', () => {
    const doc = envelope({ kind: 'user', id: 'usr_a' }, 'trashed', { kind: 'artifact', id: 'abc123' }, { format: 'markup', subtree: 0 });
    expect(eventName(doc)).toBe('artifact.trashed');
    expect(doc.payload).toEqual({ format: 'markup', subtree: 0 });
    const folder = envelope({ kind: 'user', id: 'usr_a' }, 'trashed', { kind: 'artifact', id: 'fld123' }, { format: 'folder', subtree: 4 });
    expect(folder.payload).toMatchObject({ format: 'folder', subtree: 4 });
  });
  it('a restore says whether the row came back where it was, or at the root', () => {
    const e = envelope({ kind: 'user', id: 'usr_a' }, 'restored', { kind: 'artifact', id: 'abc123' }, { landed_at_root: true });
    expect(eventName(e)).toBe('artifact.restored');
    expect(e.payload).toEqual({ landed_at_root: true });
  });
  it('is a distinct vocabulary: the catalogue holds all three beside deleted', () => {
    for (const verb of ['moved', 'trashed', 'restored', 'deleted']) {
      expect(EVENT_VERBS.artifact, verb).toContain(verb);
    }
  });
});

describe('emit', () => {
  it('hands exactly one envelope to services().events', async () => {
    const fake = fakeEvents();
    setServices({ events: fake });
    await emit({ kind: 'visitor', id: 'v'.repeat(32) }, 'viewed', { kind: 'artifact', id: 'abc123' }, { client: 'browser', user_id: null });
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ verb: 'viewed', object_id: 'abc123', subject_kind: 'visitor' });
    expect(services().events).toBe(fake);
  });
  it('never rejects, whatever the service does', async () => {
    const fake = fakeEvents();
    fake.fail = new Error('service down');
    setServices({ events: fake });
    await expect(emit(null, 'viewed', { kind: 'artifact', id: 'abc123' }, {})).resolves.toBeUndefined();
  });
});

describe('the catalogue', () => {
  const all = (Object.keys(EVENT_VERBS) as ObjectKind[]).flatMap((kind) => EVENT_VERBS[kind].map((verb) => [kind, verb] as const));
  it('has a fixture for every verb, and every fixture builds a valid envelope', () => {
    expect(all.length).toBeGreaterThanOrEqual(26);
    for (const [kind, verb] of all) {
      const payload = (FIXTURES[kind] as Record<string, unknown>)[verb];
      expect(payload, `${kind}.${verb} has no fixture`).toBeDefined();
      const e = envelope({ kind: 'user', id: 'usr_a' }, verb as never, { kind, id: 'x' }, payload as never);
      expect(eventName(e)).toBe(`${kind}.${verb}`);
      expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    }
  });
  it('carries an email ONLY on the identity verbs, and never a key that smells like content or a secret', () => {
    for (const [kind, verb] of all) {
      const e = envelope({ kind: 'user', id: 'usr_a' }, verb as never, { kind, id: 'x' }, (FIXTURES[kind] as Record<string, unknown>)[verb] as never);
      const text = JSON.stringify(e);
      const identity = kind === 'user' && (verb.startsWith('login_') || verb === 'signed_up');
      if (!identity) expect(text, `${kind}.${verb} leaks an email`).not.toMatch(/@/);
      for (const key of Object.keys(e.payload)) expect(key, `${kind}.${verb} payload key`).not.toMatch(/content|source|secret|token_hash|password|markup|body/i);
    }
  });
});
