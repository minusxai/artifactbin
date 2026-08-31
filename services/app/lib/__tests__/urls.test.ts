/**
 * The URL grammar, pure: canonical paths, title slugs, folder validation,
 * and the forgiving parse (anchor on the id, ignore the decoration).
 */
import { describe, expect, it } from 'vitest';
import { canonicalArtifactPath, parseFolder, parsePrettyPath, titleSlug } from '@/lib/urls';

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
  const doc = { id: 'Ab3xK9', title: 'Eating Healthy', folder: '' };
  it('is /a/<id> for anonymous docs and owners without usernames', () => {
    expect(canonicalArtifactPath(doc, null)).toBe('/a/Ab3xK9');
  });
  it('is /@user/<id>-<slug> for owned docs, with folders between', () => {
    expect(canonicalArtifactPath(doc, 'mxmx_owner')).toBe('/@mxmx_owner/Ab3xK9-eating-healthy');
    expect(canonicalArtifactPath({ ...doc, folder: '2026/08/12' }, 'mxmx_owner')).toBe(
      '/@mxmx_owner/2026/08/12/Ab3xK9-eating-healthy',
    );
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
    expect(parsePrettyPath(['notes'])).toBeNull(); // 5 chars — folder, not id
    expect(parsePrettyPath(['has_underscore-x'])).toBeNull();
    expect(parsePrettyPath(['toolongtobeanid123-x'])).toBeNull();
  });
});

describe('parseFolder', () => {
  it('normalizes and validates', () => {
    expect(parseFolder('')).toBe('');
    expect(parseFolder('2026/08/12')).toBe('2026/08/12');
    expect(parseFolder('/projects/notes/')).toBe('projects/notes'); // tolerant of stray slashes
  });
  it('rejects bad segments, depth, and length', () => {
    expect(parseFolder('has space/x')).toBeNull();
    expect(parseFolder('a/./b')).toBeNull();
    expect(parseFolder('a//b')).toBe('a/b'); // empty segments collapse, not reject
    expect(parseFolder('seg/'.repeat(9))).toBeNull(); // 9 deep
    expect(parseFolder(`${'x'.repeat(41)}/y`)).toBeNull();
  });
});
