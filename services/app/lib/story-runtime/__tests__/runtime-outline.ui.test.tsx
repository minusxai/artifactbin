/**
 * The document's own TABLE OF CONTENTS, as chrome — rendered by the runtime
 * beside the body exactly as the deck rail is, so it is in the SSR string at
 * its final width and the reader never sees the column jump.
 *
 * The rules a reader experiences: it is there for a sectioned editorial and
 * not for scrolly, a page, a deck or a dashboard; a click goes to the section;
 * the current section is marked as the reader scrolls; and a capture render
 * (what /export screenshots) has none of it.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { StoryRuntimeApp } from '../StoryRuntimeApp';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};
const DOC = '<article>' + ['Why', 'How', 'What next', 'Limits'].map((t, i) => `<section><h2>${i + 1}. ${t}</h2><p>text ${i}</p></section>`).join('') + '</article>';
const PAGE = '<article><h2>Only</h2><p>x</p><h2>Two</h2><p>y</p></article>';

describe('the outline rail', () => {
  it('renders beside a sectioned document, with one row per h2, in the SSR string', () => {
    const html = renderToString(<StoryRuntimeApp nodes={nodes(DOC)} refData={{}} colorMode="light" template="editorial" />);
    expect(html).toContain('class="mx-outline"');
    expect(html).toContain('aria-label="Contents"');
    expect((html.match(/class="mx-outline-row"/g) ?? []).length).toBe(4);
    expect(html).toContain('3. What next');
    // The document itself sits in the same column wrapper the deck uses.
    expect(html).toContain('class="mx-doc"');
  });

  it('renders nothing for a two-heading page, and nothing for a capture', () => {
    expect(renderToString(<StoryRuntimeApp nodes={nodes(PAGE)} refData={{}} colorMode="light" template="editorial" />)).not.toContain('mx-outline');
    expect(renderToString(<StoryRuntimeApp nodes={nodes(DOC)} refData={{}} colorMode="light" template="editorial" chrome={false} />)).not.toContain('mx-outline');
  });

  it('renders nothing for scrolly or an untemplated document with the same sections', () => {
    expect(renderToString(<StoryRuntimeApp nodes={nodes(DOC)} refData={{}} colorMode="light" template="scrolly" />)).not.toContain('mx-outline');
    expect(renderToString(<StoryRuntimeApp nodes={nodes(DOC)} refData={{}} colorMode="light" />)).not.toContain('mx-outline');
  });

  it('renders INERT rows that name their heading by path — behaviour is the entry\'s job (outline-nav), since a prose document has no runtime', () => {
    const { container } = render(<StoryRuntimeApp nodes={nodes(DOC)} refData={{}} colorMode="light" template="editorial" />);
    const rows = [...container.querySelectorAll('.mx-outline-row')];
    const headings = [...container.querySelectorAll('.mx-doc h2')];
    expect(rows.map((r) => r.getAttribute('data-mx-target'))).toEqual(headings.map((h) => h.getAttribute('data-mx-ast')));
    expect(rows.every((r) => r.getAttribute('aria-current') === null)).toBe(true);
  });

  it('indents an h3 under its section', () => {
    const html = renderToString(<StoryRuntimeApp nodes={nodes('<div><h2>A</h2><h3>A.1</h3><h2>B</h2><h2>C</h2></div>')} refData={{}} colorMode="light" template="editorial" />);
    expect(html).toContain('class="mx-outline-row mx-outline-sub"');
  });
});
