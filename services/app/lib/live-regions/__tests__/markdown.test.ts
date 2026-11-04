/**
 * A region as Markdown (markdown.ts regionMarkdown): what an agent reads is what it can send back. Reading a
 * region's Markdown and sending it back unchanged is no edit at all (applyRegionRevision against the region's own
 * snapshot yields an empty update), for every block structure and mark the schema holds, and for Markdown syntax
 * typed as text.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyRegionRevision, createRegionState, normalizeRegionHtml, openRegionDoc, regionHtml, regionMarkdown, type RegionKind } from '..';

const emptyUpdate = (update: Uint8Array) => {
  const { structs, ds } = Y.decodeUpdate(update);
  return !structs.length && ![...ds.clients.values()].some((ranges) => ranges.length);
};
function roundTrip(kind: RegionKind, html: string) {
  const saved = normalizeRegionHtml(kind, html);
  const { state, snapshot } = createRegionState(kind, saved);
  const markdown = regionMarkdown(kind, saved);
  const { update } = applyRegionRevision({ kind, live: state, savedSnapshot: snapshot, markdown });
  return { markdown, update, saved };
}

describe('regionMarkdown', () => {
  it('writes CommonMark an agent can read', () => {
    expect(regionMarkdown('rich', '<h2 data-af-id="h">Plan</h2><p data-af-id="p">Ship <strong>bold</strong>, <em>soft</em>, <code>x()</code> and <a href="https://e.test/a">a link</a>.</p><ul><li><p>one</p></li><li><p>two</p></li></ul>'))
      .toBe('## Plan\n\nShip **bold**, *soft*, `x()` and [a link](https://e.test/a).\n\n* one\n* two');
    expect(regionMarkdown('text', 'A *title* #1')).toBe('A \\*title\\* #1');
    expect(regionMarkdown('rich', '')).toBe('');
  });

  const cases: [string, RegionKind, string][] = [
    ['paragraphs and headings', 'rich', '<h1>Title</h1><p>One</p><h3>Three</h3><p>Two</p>'],
    ['marks, nested and adjacent', 'rich', '<p><a href="https://e.test/x?y=1&amp;z=2"><strong>bold link</strong></a> then <em>em <strong>both</strong></em> and <code>a*b_c</code></p>'],
    ['a bullet list', 'rich', '<ul><li><p>a</p></li><li><p>b</p></li></ul>'],
    ['an ordered list', 'rich', '<ol><li><p>first</p></li><li><p>second</p></li><li><p>third</p></li></ol>'],
    ['nested lists, deeper and back', 'rich', '<ul><li><p>a</p><ul><li><p>a1</p><ol><li><p>a1i</p></li></ol></li><li><p>a2</p></li></ul></li><li><p>b</p></li></ul><p>after</p>'],
    ['a bullet list then an ordered list', 'rich', '<ul><li><p>b</p></li></ul><ol><li><p>o</p></li></ol>'],
    ['quoted blocks, a quoted list', 'rich', '<blockquote><p>said</p><h2>head</h2><ul><li><p>q item</p></li></ul></blockquote><p>out</p>'],
    ['a code block with fences and markup inside', 'rich', '<pre><code>const a = `x`;\n```\n# not a heading\n  indented</code></pre><p>after</p>'],
    ['a rule between paragraphs', 'rich', '<p>above</p><hr><p>below</p>'],
    ['Markdown syntax typed as text', 'rich', '<p>* not a list</p><p># not a heading</p><p>1. not ordered</p><p>[not](a link) _x_ **y** `z` &lt;b&gt;html&lt;/b&gt; \\ back</p><p>+ plus - dash &gt; quote</p>'],
    ['text-kind with Markdown syntax', 'text', '# Title with *stars* and [brackets] &amp; `ticks`'],
    ['an empty text region', 'text', ''],
    ['non-breaking spaces and unicode', 'rich', '<p>a&nbsp;&nbsp;b — café 日本語 🎉</p>'],
  ];
  for (const [name, kind, html] of cases) {
    it(`reading back unchanged is no edit: ${name}`, () => {
      const { markdown, update, saved } = roundTrip(kind, html);
      expect(emptyUpdate(update), `${markdown}\n----\n${saved}`).toBe(true);
    });
  }

  it('an agent\'s edit to the Markdown it read changes only that', () => {
    const saved = normalizeRegionHtml('rich', '<p data-af-id="a">alpha</p><ul data-af-id="l"><li data-af-id="i"><p>item</p></li></ul>');
    const { state, snapshot } = createRegionState('rich', saved);
    const markdown = regionMarkdown('rich', saved).replace('item', 'item, revised');
    const { update } = applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: snapshot, markdown });
    const after = openRegionDoc(state);
    Y.applyUpdate(after, update);
    expect(regionHtml('rich', Y.encodeStateAsUpdate(after))).toBe('<p data-af-id="a">alpha</p><ul data-af-id="l"><li data-af-id="i"><p>item, revised</p></li></ul>');
  });
});
