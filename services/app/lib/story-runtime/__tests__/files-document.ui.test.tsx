/**
 * A FOLDER, RENDERED THE WAY IT IS SERVED — the two facts about `<Files>` that
 * a unit test of the component cannot see, because both are decided upstream of
 * its props.
 *
 * 1. THE GLYPHS. A folder's whole document is `<Files data="$children" />` and
 *    names no `<Icon>` anywhere, so the server's scan has to know that this
 *    component draws icons or the listing comes out with a hole in every row —
 *    green everywhere, blank in production (lib/story/icon-glyphs).
 * 2. THE CAPTURE. `chrome=0` is a prop of the runtime, not of the document, so
 *    the adapter is the only thing that can tell the component it is being
 *    photographed. Without that, an og card of a folder is a capture waiting on
 *    a capture per child — and on a 404 for every private one.
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

const FOLDER = '<Helmet><Query name="children">{`select * from ref_abc123`}</Query></Helmet>\n<Files data="$children" variant="icons" />';

const ROWS = [
  { id: 'doc001', title: 'Board update', format: 'markup', level: 1, visibility: 'public', updated_at: '2026-09-05T10:00:00Z', url: '/a/doc001', thumbnail: '/a/doc001/export?mode=card&v=3', views: 41, sparkline: null },
  { id: 'sub001', title: 'Q3', format: 'folder', level: 1, visibility: 'public', updated_at: '2026-09-04T10:00:00Z', url: '/a/sub001', thumbnail: null, views: null, sparkline: null },
];

const FLOW: Dataflow = { values: [], queries: [{ name: 'children', sql: 'select * from ref_abc123', params: [], refs: ['abc123'], start: 0, end: 0 }] };
const HEAD = { id: 'abc123', title: 'Field Notes', trail: [] };

function renderFolder(chrome: boolean, over: Partial<React.ComponentProps<typeof StoryRuntimeApp>> = {}) {
  const parsed = parseJsx(FOLDER);
  if (!parsed.ok) throw new Error(parsed.error);
  // The declaration the scaffold carries, by hand: what this exercises is the
  // adapter between the store and the component, not the parser above it.
  return renderWithProviders(
    <StoryRuntimeApp
      nodes={parsed.nodes}
      refData={{}}
      glyphs={glyphsForNodes(parsed.nodes)}
      colorMode="light"
      chrome={chrome}
      folder={HEAD}
      dataflow={{ flow: FLOW, state: { values: {}, tables: { children: { rows: ROWS, columns: [] } }, errors: {} } }}
      {...over}
    />,
  );
}

describe('a folder document', () => {
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

/**
 * SETTLED IS THE STORE'S OWN WORD, and the adapter is the only place that can
 * translate it. `<Files>` is handed rows; whether the absence of rows is "not
 * yet" or "nothing here" is a fact about the query, which lives in the store's
 * pending set and reaches the component through nothing else.
 *
 * The three cases below are the three the folder page actually has, and the
 * first is the one P2 got wrong in the other direction: a document that
 * arrives WITHOUT its rows (paint-first — the reader's normal case) has its
 * query marked dirty by the store itself, so it is pending, so it is not
 * settled, so the page is blank rather than claiming to be empty.
 */
describe('a folder with nothing in it', () => {
  it('stays blank while the rows have not arrived', () => {
    // No `state`: the paint-first shape. The store marks every declared query
    // dirty, which is exactly what `pending` reports on both sides of
    // hydration.
    const { container } = renderFolder(true, { dataflow: { flow: FLOW } });
    expect(container.textContent).not.toContain('Nothing here yet');
  });

  it('says so once the query has answered with no rows', () => {
    const { container } = renderFolder(true, {
      dataflow: { flow: FLOW, state: { values: {}, tables: { children: { rows: [], columns: [] } }, errors: {} } },
    });
    expect(container.textContent).toContain('Nothing here yet.');
    expect(container.textContent).toContain('parent_id: "abc123"');
  });

  it('never calls a FAILED query an empty folder', () => {
    const { container } = renderFolder(true, {
      dataflow: { flow: FLOW, state: { values: {}, tables: {}, errors: { children: 'no such table: ref_abc123' } } },
    });
    expect(container.textContent).not.toContain('Nothing here yet');
  });
});

/** The head is the island's, so the served document and the browser draw the same one. */
describe('a folder head', () => {
  it('names the folder above its listing', () => {
    const { container } = renderFolder(true);
    expect(container.querySelector('[data-slot="files-head"]')).toBeTruthy();
    expect(container.textContent).toContain('Field Notes');
  });
});
