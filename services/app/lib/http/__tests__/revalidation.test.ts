/**
 * The validators a document answers with (lib/http/revalidation): a strong ETag over everything that
 * determines the bytes, the `If-None-Match` comparison, and the 304.
 */
import { describe, expect, it } from 'vitest';
import { etagOf, matchingTag, notModified, revalidationHeaders, withEncoding } from '../revalidation';

const ifNoneMatchHits = (header: string | null, etag: string): boolean => matchingTag(header, etag) !== null;

describe('etagOf', () => {
  it('is a strong validator, the same for equal facts in any key order and different for any change', () => {
    const facts = { id: 'Ab3xK9', version: 4, viewer: { userId: 'u1', tokenId: null }, list: ['a', 'b'] };
    const tag = etagOf(facts);
    expect(tag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(etagOf({ list: ['a', 'b'], viewer: { tokenId: null, userId: 'u1' }, version: 4, id: 'Ab3xK9' })).toBe(tag);
    for (const changed of [{ ...facts, version: 5 }, { ...facts, viewer: { userId: 'u2', tokenId: null } }, { ...facts, viewer: { userId: 'u1', tokenId: 't' } }, { ...facts, list: ['b', 'a'] }, { ...facts, id: 'ab3xk9' }, { ...facts, extra: undefined, list: ['a', 'b', 'c'] }]) {
      expect(etagOf(changed)).not.toBe(tag);
    }
    // `undefined` is absent, `null` is a value.
    expect(etagOf({ a: 1, b: undefined })).toBe(etagOf({ a: 1 }));
    expect(etagOf({ a: 1, b: null })).not.toBe(etagOf({ a: 1 }));
  });
});

describe('ifNoneMatchHits', () => {
  const tag = etagOf({ a: 1 });
  it('hits on the tag itself, in a list, weak or with the encoding it was sent in, and on *', () => {
    expect(ifNoneMatchHits(tag, tag)).toBe(true);
    expect(ifNoneMatchHits(`"other", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchHits(`W/${tag}`, tag)).toBe(true);
    expect(ifNoneMatchHits(withEncoding(tag, 'br'), tag)).toBe(true);
    expect(ifNoneMatchHits(withEncoding(tag, 'gzip'), tag)).toBe(true);
    expect(ifNoneMatchHits('*', tag)).toBe(true);
  });
  it('misses on another tag, an absent or empty header, and anything malformed', () => {
    expect(ifNoneMatchHits(etagOf({ a: 2 }), tag)).toBe(false);
    expect(ifNoneMatchHits(null, tag)).toBe(false);
    expect(ifNoneMatchHits('', tag)).toBe(false);
    expect(ifNoneMatchHits(tag.slice(1, -1), tag)).toBe(false);
    expect(ifNoneMatchHits(`${tag}x`, tag)).toBe(false);
  });
});

describe('matchingTag', () => {
  it('names the representation the client holds, so the 304 can answer for that body', () => {
    const tag = etagOf({ a: 1 });
    expect(matchingTag(tag, tag)).toBe(tag);
    expect(matchingTag(`"other", W/${withEncoding(tag, 'br')}`, tag)).toBe(withEncoding(tag, 'br'));
    expect(matchingTag('*', tag)).toBe(tag);
    expect(matchingTag('"other"', tag)).toBeNull();
  });
});

describe('withEncoding', () => {
  it('names the representation a body was sent in, and leaves an unencoded one alone', () => {
    const tag = etagOf({ a: 1 });
    expect(withEncoding(tag, null)).toBe(tag);
    expect(withEncoding(tag, 'br')).toBe(`${tag.slice(0, -1)}-br"`);
  });
});

describe('notModified and revalidationHeaders', () => {
  it('answers 304 with no body, the validator, private revalidation and the encoding vary', async () => {
    const tag = etagOf({ a: 1 });
    const res = notModified(tag);
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe(tag);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    expect(revalidationHeaders(tag)).toEqual({ ETag: tag, 'Cache-Control': 'private, no-cache' });
  });
});
