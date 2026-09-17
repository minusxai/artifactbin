/**
 * The URL grammar, pure: canonical paths, title slugs, and the forgiving parse
 * (anchor on the id, ignore the decoration).
 *
 * The `parseFolder` grammar is DELETED rather than rewritten: nesting is not in
 * the address any more — a folder is an artifact with its own id-anchored
 * address, and two sibling folders may share a name, so a path through them was
 * ambiguous by construction. There is nothing left for those cases to assert.
 */
import { describe, expect, it } from 'vitest';
import { canonicalArtifactPath, parsePrettyPath, titleSlug } from '@/lib/urls';

describe('titleSlug', () => {
  it('lowercases, hyphenates, trims, clamps', () => {
    expect(titleSlug('Eating Healthy!')).toBe('eating-healthy');
    expect(titleSlug('  Q3 — Revenue & Growth  ')).toBe('q3-revenue-growth');
    expect(titleSlug(null)).toBe('');
    expect(titleSlug('!!!')).toBe('');
    expect(titleSlug('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('canonicalArtifactPath', () => {
  const doc = { id: 'Ab3xK9', title: 'Eating Healthy' };
  it('is /a/<id> for anonymous docs and owners without usernames', () => {
    expect(canonicalArtifactPath(doc, null)).toBe('/a/Ab3xK9');
  });
  it('is /@user/<id>-<slug> for owned docs — one segment, never a folder path', () => {
    expect(canonicalArtifactPath(doc, 'mxmx_owner')).toBe('/@mxmx_owner/Ab3xK9-eating-healthy');
    expect(canonicalArtifactPath({ ...doc, title: null }, 'mxmx_owner')).toBe('/@mxmx_owner/Ab3xK9');
  });
});

describe('parsePrettyPath — forgiving, id-anchored', () => {
  it('finds the id in the last segment regardless of decoration', () => {
    expect(parsePrettyPath(['Ab3xK9-eating-healthy'])).toEqual({ id: 'Ab3xK9' });
    expect(parsePrettyPath(['2026', '08', 'Ab3xK9'])).toEqual({ id: 'Ab3xK9' });
    expect(parsePrettyPath(['Ab3xK9-totally-wrong-title'])).toEqual({ id: 'Ab3xK9' });
  });
  it('answers null when the last segment cannot carry an id', () => {
    expect(parsePrettyPath([])).toBeNull();
    expect(parsePrettyPath(['notes'])).toBeNull(); // 5 chars — too short to be an id
    expect(parsePrettyPath(['has_underscore-x'])).toBeNull();
    expect(parsePrettyPath(['toolongtobeanid123-x'])).toBeNull();
  });
});

