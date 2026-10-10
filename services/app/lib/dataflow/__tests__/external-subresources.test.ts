/**
 * The self-contained rule's subresource positions (refs.ts `findExternalSubresources`): an `<img src>`
 * URL is served as written, every OTHER subresource position keeps the hard refusal, and a frame's
 * `src` is not an import at all. The tag vocabulary itself is lib/story-ui/__tests__/interactive-tags.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { findExternalSubresources } from '../refs';

describe('external subresources', () => {
  it('refuses an external URL in every subresource position but an image src', () => {
    expect(findExternalSubresources('<img srcSet="https://cdn.example/x.png 1x" />').length).toBeGreaterThan(0);
    expect(findExternalSubresources('<div background="https://cdn.example/b.png" />').length).toBeGreaterThan(0);
  });

  it('leaves an https <iframe> src out of the rule — a frame is not an import', () => {
    expect(findExternalSubresources('<div><iframe src="https://player.vimeo.com/video/76979871" title="Clip" /></div>')).toEqual([]);
  });
});
