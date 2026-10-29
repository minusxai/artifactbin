/**
 * lib/platform's contract, through its index: identifiers, the request scope and the event envelope.
 * Configuration, the database and the injected services are exercised by every module test that stands on them.
 */
import type { EventEnvelope, EventsService } from '@artifactbin/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_ID_LENGTH, ID_RE, actorSubject, currentHeaders, currentRequest, emit, envelope, generateFileId, generateInternalId,
  generateTokenId, overrideRequestHeaders, runWithRequest, services, setServices,
} from '@/lib/platform';

describe('identifiers', () => {
  it('mints file ids of FILE_ID_LENGTH alphanumerics that ID_RE accepts', () => {
    const ids = Array.from({ length: 500 }, generateFileId);
    for (const id of ids) {
      expect(id).toHaveLength(FILE_ID_LENGTH);
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
      expect(ID_RE.test(id)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('accepts the 6 to 12 character range and nothing else', () => {
    for (const id of ['abcDE1', 'abcDEF123456']) expect(ID_RE.test(id), id).toBe(true);
    for (const id of ['abcDE', 'abcDEF1234567', 'abc-DE', 'abc DE1', '']) expect(ID_RE.test(id), id).toBe(false);
  });

  it('mints internal ids as base36 and token ids with the tok_ prefix', () => {
    const internal = Array.from({ length: 200 }, generateInternalId);
    for (const id of internal) expect(id).toMatch(/^[0-9a-z]{1,19}$/);
    expect(new Set(internal).size).toBe(internal.length);
    const tokens = Array.from({ length: 200 }, generateTokenId);
    for (const id of tokens) expect(id).toMatch(/^tok_[0-9a-z]{1,13}$/);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('request scope', () => {
  afterEach(() => overrideRequestHeaders(undefined));

  it('has no request outside a run', async () => {
    expect(currentRequest()).toBeNull();
    expect(await currentHeaders()).toBeNull();
  });

  it('holds the request across awaits for the run, and only for it', async () => {
    const request = new Request('https://example.test/a', { headers: { 'user-agent': 'contract-test' } });
    const seen = await runWithRequest(request, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { request: currentRequest(), agent: (await currentHeaders())?.get('user-agent') };
    });
    expect(seen).toEqual({ request, agent: 'contract-test' });
    expect(currentRequest()).toBeNull();
  });

  it('keeps concurrent runs apart', async () => {
    const run = (path: string, delay: number) => runWithRequest(new Request(`https://example.test/${path}`), async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return currentRequest()?.url;
    });
    expect(await Promise.all([run('first', 5), run('second', 1)])).toEqual(['https://example.test/first', 'https://example.test/second']);
  });

  it('answers the headers override first, asked on every call, null meaning off-request', async () => {
    let headers: HeadersInit | null = { 'user-agent': 'override' };
    overrideRequestHeaders(() => headers);
    await runWithRequest(new Request('https://example.test/', { headers: { 'user-agent': 'request' } }), async () => {
      expect((await currentHeaders())?.get('user-agent')).toBe('override');
      headers = null;
      expect(await currentHeaders()).toBeNull();
    });
    overrideRequestHeaders(undefined);
    expect(await currentHeaders()).toBeNull();
  });
});

describe('event envelope', () => {
  const previous = services().events;
  afterAll(() => setServices({ events: previous }));

  it('stamps an app sentence: a fresh id, the time, both subject columns and its own payload copy', () => {
    const payload = { client: 'script', user_id: 'usr_1' };
    const before = Date.now();
    const first = envelope({ kind: 'user', id: 'usr_1' }, 'viewed', { kind: 'artifact', id: 'abcDE1' }, payload);
    const second = envelope(null, 'viewed', { kind: 'artifact', id: 'abcDE1' }, payload);
    expect(first).toMatchObject({
      source: 'app', subject_kind: 'user', subject_id: 'usr_1', verb: 'viewed', object_kind: 'artifact', object_id: 'abcDE1',
      payload: { client: 'script', user_id: 'usr_1' },
    });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(Date.parse(first.at)).toBeGreaterThanOrEqual(before - 1);
    expect(second).toMatchObject({ subject_kind: null, subject_id: null });
    payload.client = 'changed';
    expect(first.payload).toEqual({ client: 'script', user_id: 'usr_1' });
  });

  it('emits through the injected events service and never rejects', async () => {
    const sent: EventEnvelope[] = [];
    setServices({ events: { emit: async (events) => { sent.push(...events); } } as EventsService });
    await emit({ kind: 'token', id: 'tok_1' }, 'viewed', { kind: 'artifact', id: 'abcDE1' }, { client: null, user_id: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ source: 'app', subject_kind: 'token', subject_id: 'tok_1', verb: 'viewed', object_id: 'abcDE1' });

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    setServices({ events: { emit: async () => { throw new Error('log down'); } } as unknown as EventsService });
    await expect(emit(null, 'viewed', { kind: 'artifact', id: 'abcDE1' }, { client: null, user_id: null })).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('speaks as the account, else the token, else nobody', () => {
    expect(actorSubject({ userId: 'usr_1', tokenId: 'tok_1' })).toEqual({ kind: 'user', id: 'usr_1' });
    expect(actorSubject({ userId: null, tokenId: 'tok_1' })).toEqual({ kind: 'token', id: 'tok_1' });
    expect(actorSubject({ userId: null, tokenId: null })).toBeNull();
  });
});
