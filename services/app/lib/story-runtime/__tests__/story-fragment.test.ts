import { describe, expect, it } from 'vitest';
import { STORY_SURFACE_PARAM, fragmentView, storyFragmentPath, storyFragmentUrl } from '../story-fragment';

describe('storyFragmentPath', () => {
  it('is the document’s /story door, with the id encoded', () => {
    expect(storyFragmentPath('abc123')).toBe('/a/abc123/story');
    expect(storyFragmentPath('a/b?c#d')).toBe('/a/a%2Fb%3Fc%23d/story');
  });
});

describe('storyFragmentUrl', () => {
  it('keeps the page’s own params, names the surface and carries the view state as JSON', () => {
    const url = new URL(storyFragmentUrl('doc', '?$region=north&reader=1', 'app', { 'n1:tab': 'billing', ü: [1, true] }), 'https://x.example');
    expect(url.pathname).toBe('/a/doc/story');
    expect(url.searchParams.get('$region')).toBe('north');
    expect(url.searchParams.get('reader')).toBe('1');
    expect(url.searchParams.get(STORY_SURFACE_PARAM)).toBe('app');
    expect(JSON.parse(url.searchParams.get('mx-view')!)).toEqual({ 'n1:tab': 'billing', ü: [1, true] });
  });

  it('replaces a surface or view the page already carried, and omits an empty view', () => {
    const url = new URL(storyFragmentUrl('doc', 'surface=app&mx-view=%7B%7D', 'raw', {}), 'https://x.example');
    expect(url.searchParams.getAll(STORY_SURFACE_PARAM)).toEqual(['raw']);
    expect(url.searchParams.has('mx-view')).toBe(false);
    expect(storyFragmentUrl('doc', '', 'raw', null)).toBe('/a/doc/story?surface=raw');
  });
});

describe('fragmentView', () => {
  it('keeps a view state that fits a request line and drops one that does not', () => {
    const small = { tab: 'x'.repeat(100) };
    expect(fragmentView(small)).toBe(small);
    expect(fragmentView({ tab: 'x'.repeat(7000) })).toEqual({});
    // The bound is on the ENCODED size: multi-byte characters count as their escapes.
    expect(fragmentView({ tab: 'ü'.repeat(1100) })).toEqual({});
    expect(fragmentView({})).toEqual({});
  });
});
