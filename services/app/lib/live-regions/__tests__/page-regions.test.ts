/**
 * Which elements of a saved page are live regions: declared kind, a valid id, and never an id that a sibling
 * region route already owns (`/regions/flush`, `/regions/stream`), which no region request could address.
 */
import { describe, expect, it } from 'vitest';
import { editableRegions, isRegionId } from '../page-regions';

const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

describe('editable regions of a page', () => {
  it('lists rich and text regions with their inner HTML', () => {
    expect(editableRegions(page('<article data-af-editable="rich" data-af-id="r1"><p>Hi</p></article><p data-af-editable="text" data-af-id="t1">Line</p>')))
      .toEqual([{ id: 'r1', kind: 'rich', inner: '<p>Hi</p>' }, { id: 't1', kind: 'text', inner: 'Line' }]);
  });

  it('skips an unknown kind and an element without an id', () => {
    expect(editableRegions(page('<div data-af-editable="code" data-af-id="c1">x</div><article data-af-editable="rich"><p>x</p></article>'))).toEqual([]);
  });

  it('never treats a route name as a region id', () => {
    for (const reserved of ['flush', 'stream']) {
      expect(isRegionId(reserved)).toBe(false);
      expect(editableRegions(page(`<article data-af-editable="rich" data-af-id="${reserved}"><p>x</p></article>`))).toEqual([]);
    }
    expect(isRegionId('af-12')).toBe(true);
  });
});
