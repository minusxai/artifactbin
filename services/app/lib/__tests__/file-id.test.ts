/**
 * File IDs — the ONE identifier an artifact has. 6 chars of [a-zA-Z0-9]:
 * the API handle, the ref:<id> target, and the URL address, all the same
 * value. An ADDRESS, not a secret (privacy is the visibility ACL's job).
 * ID_RE accepts 6-12 so longer ids can be minted later with no migration.
 */
import { describe, expect, it } from 'vitest';
import { FILE_ID_LENGTH, generateFileId, generateInternalId, generateTokenId, ID_RE } from '@/lib/ids';

describe('generateFileId', () => {
  it('mints exactly 6 chars of [a-zA-Z0-9]', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateFileId();
      expect(id).toHaveLength(FILE_ID_LENGTH);
      expect(id).toMatch(/^[a-zA-Z0-9]{6}$/);
    }
  });

  it('draws from the full base62 alphabet (not a lowercase subset)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const c of generateFileId()) seen.add(c);
    // 3000 draws over 62 symbols: every class must appear.
    expect([...seen].some((c) => /[A-Z]/.test(c))).toBe(true);
    expect([...seen].some((c) => /[a-z]/.test(c))).toBe(true);
    expect([...seen].some((c) => /[0-9]/.test(c))).toBe(true);
    expect(seen.size).toBeGreaterThan(50);
  });

  it('does not repeat across a small sample', () => {
    const ids = new Set(Array.from({ length: 1000 }, generateFileId));
    expect(ids.size).toBe(1000);
  });
});

describe('ID_RE', () => {
  it('accepts 6-12 alphanumeric chars, any case', () => {
    for (const good of ['abc123', 'ABC123', 'Ab3xK9', '123456', 'abcdefghij12', 'ZZZZZZ']) {
      expect(good).toMatch(ID_RE);
    }
  });

  it('rejects everything else — old art_ ids, separators, wrong lengths', () => {
    for (const bad of ['abc12', 'abcdefghij123', 'art_abc123', 'abc-12', 'abc_12', '', 'abc 12', 'abc12!', 'ab.c12']) {
      expect(bad).not.toMatch(ID_RE);
    }
  });
});

describe('internal ids (usr_/tok_ — never in URLs or refs)', () => {
  it('generateInternalId is 96-bit base36', () => {
    const id = generateInternalId();
    expect(id).toMatch(/^[0-9a-z]{8,20}$/);
  });

  it('generateTokenId keeps its tok_ prefix', () => {
    expect(generateTokenId()).toMatch(/^tok_[0-9a-z]+$/);
  });
});
