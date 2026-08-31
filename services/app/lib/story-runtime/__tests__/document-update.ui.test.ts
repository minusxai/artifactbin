/**
 * The non-React half of adopting a new document: which messages count, and
 * what happens to the stylesheets and design attributes that live outside the
 * React root.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORY_DOCUMENT_MESSAGE } from '../contract';
import { applyDocumentChrome, isStoryDocumentUpdate } from '../document-update';

const update = (extra: Record<string, unknown> = {}) =>
  ({ type: STORY_DOCUMENT_MESSAGE, nodes: [], ...extra }) as never;

describe('isStoryDocumentUpdate', () => {
  it('accepts a well-formed update', () => {
    expect(isStoryDocumentUpdate({ type: STORY_DOCUMENT_MESSAGE, nodes: [] })).toBe(true);
  });

  it('rejects anything else that might be posted into a window', () => {
    for (const junk of [null, undefined, 0, 'mx:document', [], {}, { type: 'mx:query', nodes: [] },
      { type: STORY_DOCUMENT_MESSAGE }, { type: STORY_DOCUMENT_MESSAGE, nodes: 'not-an-array' }]) {
      expect(isStoryDocumentUpdate(junk)).toBe(false);
    }
  });
});

describe('applyDocumentChrome', () => {
  let doc: Document;
  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('t');
    doc.documentElement.className = 'light';
    const tw = doc.createElement('style');
    tw.setAttribute('data-mx-tw', '');
    tw.textContent = '.a{color:red}';
    doc.head.appendChild(tw);
  });

  const tw = () => doc.head.querySelector('style[data-mx-tw]');
  const author = () => doc.head.querySelector('style[data-mx-author]');

  it('swaps the compiled sheet in place, keeping the same node', () => {
    const node = tw();
    applyDocumentChrome(doc, update({ compiledCss: '.a{color:blue}' }));
    expect(tw()).toBe(node);
    expect(tw()!.textContent).toBe('.a{color:blue}');
  });

  it('leaves the sheet alone when the field is absent (absent = unchanged)', () => {
    applyDocumentChrome(doc, update({}));
    expect(tw()!.textContent).toBe('.a{color:red}');
  });

  it('removes the sheet when it is explicitly null', () => {
    applyDocumentChrome(doc, update({ compiledCss: null }));
    expect(tw()).toBeNull();
  });

  it("creates a sheet the document did not have (its first utility class arrives mid-read)", () => {
    applyDocumentChrome(doc, update({ authorCss: '.b{color:green}' }));
    expect(author()!.textContent).toBe('.b{color:green}');
    expect(author()!.parentElement).toBe(doc.head);
  });

  it('does not touch a node whose css is unchanged (no needless re-style)', () => {
    const before = tw()!.textContent;
    applyDocumentChrome(doc, update({ compiledCss: before }));
    expect(tw()!.textContent).toBe(before);
  });

  it('sets and clears the theme attribute the theme sheet selects on', () => {
    applyDocumentChrome(doc, update({ theme: 'modernist' }));
    expect(doc.documentElement.getAttribute('data-theme')).toBe('modernist');
    applyDocumentChrome(doc, update({ theme: null }));
    expect(doc.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('switches the colour mode class pair', () => {
    applyDocumentChrome(doc, update({ colorMode: 'dark' }));
    expect(doc.documentElement.classList.contains('dark')).toBe(true);
    expect(doc.documentElement.classList.contains('light')).toBe(false);
    applyDocumentChrome(doc, update({ colorMode: 'light' }));
    expect(doc.documentElement.classList.contains('light')).toBe(true);
  });

  it('leaves the document alone for an update that carries no chrome at all', () => {
    const html = doc.documentElement.outerHTML;
    applyDocumentChrome(doc, update({}));
    expect(doc.documentElement.outerHTML).toBe(html);
  });

  it("a reader's mode override survives a live frame: the mode class stays, the rest still applies", () => {
    // The frame carries the AUTHOR's colorMode; a reader who flipped the
    // toggle (the root already classed with their choice) must not have it
    // stomped by every agent write.
    doc.documentElement.className = 'dark';
    applyDocumentChrome(doc, update({ colorMode: 'light', theme: 'modernist', compiledCss: '.c{color:red}' }), 'dark');
    expect(doc.documentElement.classList.contains('dark')).toBe(true);
    expect(doc.documentElement.classList.contains('light')).toBe(false);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('modernist');
    expect(tw()!.textContent).toBe('.c{color:red}');
  });
});
