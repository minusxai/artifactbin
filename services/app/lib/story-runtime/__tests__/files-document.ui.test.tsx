/**
 * A BOUND LISTING, RENDERED THE WAY IT IS SERVED — the two facts about
 * `<Files>` that a unit test of the component cannot see, because both are
 * decided upstream of its props.
 *
 * 1. THE GLYPHS. A document that binds a folder's children with
 *    `<Files data="$q" />` need name no `<Icon>` anywhere, so the server's scan
 *    has to know that this component draws icons or the listing comes out with
 *    a hole in every row — green everywhere, blank in production
 *    (lib/story/icon-glyphs).
 * 2. THE CAPTURE. `chrome=0` is a prop of the runtime, not of the document, so
 *    the adapter is the only thing that can tell the component it is being
 *    photographed. Without that, an og card of a document holding a listing is
 *    a capture waiting on a capture per row — and on a 404 for every private
 *    one.
 *
 * Both live here rather than in components/__tests__/files.ui.test.tsx because
 * both are about the wiring, and both were invisible to it.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { parseJsx } from '@/lib/jsx';
import { glyphsForNodes } from '@/lib/story/icon-glyphs';
import type { Dataflow } from '@/lib/story/dataflow';

const DOC = '<Helmet><Query name="children">{`select * from ref_abc123`}</Query></Helmet>\n<h1>Field Notes</h1>\n<Files data="$children" variant="icons" />';

const ROWS = [
  { id: 'doc001', title: 'Board update', format: 'markup', level: 1, visibility: 'public', updated_at: '2026-09-05T10:00:00Z', url: '/a/doc001', thumbnail: '/a/doc001/export?mode=card&v=3', views: 41, sparkline: null },
  { id: 'sub001', title: 'Q3', format: 'folder', level: 1, visibility: 'public', updated_at: '2026-09-04T10:00:00Z', url: '/a/sub001', thumbnail: null, views: null, sparkline: null },
];

const FLOW: Dataflow = { values: [], queries: [{ name: 'children', sql: 'select * from ref_abc123', params: [], refs: ['abc123'], start: 0, end: 0 }] };

function renderFolder(chrome: boolean, over: Partial<React.ComponentProps<typeof StoryRuntimeApp>> = {}) {
  const parsed = parseJsx(DOC);
  if (!parsed.ok) throw new Error(parsed.error);
  // The declaration by hand: what this exercises is the adapter between the
  // store and the component, not the parser above it.
  return renderWithProviders(
    <StoryRuntimeApp
      nodes={parsed.nodes}
      refData={{}}
      glyphs={glyphsForNodes(parsed.nodes)}
      colorMode="light"
      chrome={chrome}
      dataflow={{ flow: FLOW, state: { values: {}, tables: { children: { rows: ROWS, columns: [] } }, errors: {} } }}
      {...over}
    />,
  );
}

describe('a document that lists a folder', () => {
  it('draws a glyph in the rows that have no card', () => {
    const { container } = renderFolder(true);
    const folderRow = container.querySelector('[aria-label="Open Q3"] [data-glyph="folder"] svg');
    expect(folderRow, 'the listing drew no glyph — the server resolved none for <Files>').toBeTruthy();
    // The other row has a card, so it draws that instead.
    expect(container.querySelector('[aria-label="Open Board update"] img')).toBeTruthy();
  });

  it('draws glyphs ONLY inside a capture', () => {
    const { container } = renderFolder(false);
    expect(container.querySelector('img'), 'a capture pulled in another artifact’s card').toBeNull();
    expect(container.querySelector('[aria-label="Open Board update"] [data-glyph="markup"] svg')).toBeTruthy();
  });
});

