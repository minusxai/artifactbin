/**
 * The document editor and native-v1's image node (lib/live-regions native-schema.ts): an editor that loads a document
 * holding an image keeps it, shows the address the served page gave it and saves it; an HTML paste or drop builds
 * images from the sources a document may hold (lib/markdown imageAllowed) and drops the rest; a copy carries the stored
 * source; the `image` command inserts one by address.
 */
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '../../html-page';
import { compactRegion, createRegionState, regionHtml, validateRegionUpdate } from '../../live-regions';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { mountRegionEditor } from '../native-region-editor';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
const kind = 'rich-native-v1';
const SAVED = '<p data-af-id="p1">See <img data-af-id="i1" src="ref:abcdef12" alt="Chart" title="T"> and <img data-af-id="i2" src="https://i.example/p.png" alt=""></p>';
const SERVED = '<p data-af-id="p1">See <img data-af-id="i1" src="/a/abcdef12/raw?v=3" alt="Chart" title="T"> and <img data-af-id="i2" src="/a/page01/assets?u=https%3A%2F%2Fi.example%2Fp.png" alt=""></p>';

function mount(served: string, post: (update: Uint8Array) => void = () => {}, saved = SAVED, pageId?: string) {
  const initial = createRegionState(kind, saved);
  const root = document.createElement('article');
  root.innerHTML = served;
  document.body.append(root);
  const editor = mountRegionEditor({ win: window, root, regionId: 'doc', kind, clientId: 801, state: initial.state, ...(pageId ? { pageId } : {}), post(message) { if (message.kind === 'region-update') post(message.update); } });
  cleanup.push(() => { editor.destroy(); root.remove(); });
  return { editor, root, initial };
}
const clipboard = (plain: string, html = '') => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? plain : '') } });
  return event;
};
const images = (editor: ReturnType<typeof mount>['editor']) => {
  const found: unknown[] = [];
  editor.view.state.doc.descendants(node => { if (node.type.name === 'image') found.push(node.attrs); });
  return found;
};

it('loads a document holding images without changing it, and shows the served addresses', () => {
  const posted: Uint8Array[] = [];
  const { editor, root } = mount(SERVED, update => posted.push(update));
  editor.flush();
  expect(posted).toEqual([]);
  expect(images(editor)).toEqual([
    { src: 'ref:abcdef12', alt: 'Chart', title: 'T', afId: 'i1' },
    { src: 'https://i.example/p.png', alt: '', title: null, afId: 'i2' },
  ]);
  expect([...root.querySelectorAll('img:not(.ProseMirror-separator)')].map(img => [img.getAttribute('src'), img.getAttribute('alt'), img.getAttribute('data-af-id')])).toEqual([
    ['/a/abcdef12/raw?v=3', 'Chart', 'i1'], ['/a/page01/assets?u=https%3A%2F%2Fi.example%2Fp.png', '', 'i2'],
  ]);
});

it('without a served address, an upload shows at its raw address', () => {
  const { root } = mount('');
  expect([...root.querySelectorAll('img:not(.ProseMirror-separator)')].map(img => img.getAttribute('src'))).toEqual(['/a/abcdef12/raw', 'https://i.example/p.png']);
});

it('typing beside an image passes the server\'s check and saving keeps the image', () => {
  let server: Uint8Array | undefined;
  const { editor, initial } = mount(SERVED, update => {
    const checked = validateRegionUpdate(kind, server ?? initial.state, update, 801);
    server = Y.encodeStateAsUpdate(checked.doc);
  });
  editor.view.dispatch(editor.view.state.tr.insertText('Now ', 1));
  editor.flush();
  expect(regionHtml(kind, server!)).toBe(SAVED.replace('>See ', '>Now See '));
  const page = canonicalizeHtmlPage(`<html><body><article data-af-id="doc" data-af-editable="rich-native-v1">${SAVED}</article></body></html>`);
  expect(compactRegion({ savedHtml: page.html, ledger: page.ledger, regionId: 'doc', state: server! }).html).toContain(SAVED.replace('>See ', '>Now See '));
});

/** A mounted editor whose every posted update passes the server's check, and the region as the server would save it. */
function checked(served = SERVED, saved = SAVED) {
  let server: Uint8Array | undefined;
  const mounted = mount(served, update => { server = Y.encodeStateAsUpdate(validateRegionUpdate(kind, server ?? mounted.initial.state, update, 801).doc); }, saved);
  const saveNow = () => {
    mounted.editor.flush();
    const page = canonicalizeHtmlPage(`<html><body><article data-af-id="doc" data-af-editable="rich-native-v1">${saved}</article></body></html>`);
    return { live: regionHtml(kind, server!), saved: compactRegion({ savedHtml: page.html, ledger: page.ledger, regionId: 'doc', state: server! }).html };
  };
  return { ...mounted, saveNow };
}

it('an HTML paste builds images from the sources a document may hold and drops every other, never inlining data', () => {
  const page = checked();
  const html = '<p>pasted <img src="https://i.example/new.png" alt="new" title="N"> <img src="ref:zzzzzz99"> <img src="data:image/png;base64,AA" alt="d"> <img src="javascript:alert(1)"> <img src="http://i.example/h.png"> <img src="//host.example/p.png"> <img alt="none"></p>';
  page.editor.view.dispatch(page.editor.view.state.tr.setSelection(TextSelection.atEnd(page.editor.view.state.doc)));
  page.editor.view.pasteHTML(html, clipboard('pasted', html));
  expect(images(page.editor).slice(2)).toEqual([
    { src: 'https://i.example/new.png', alt: 'new', title: 'N', afId: null },
    { src: 'ref:zzzzzz99', alt: '', title: null, afId: null },
  ]);
  const { live, saved } = page.saveNow();
  expect(live).toContain('pasted <img src="https://i.example/new.png" alt="new" title="N"> <img src="ref:zzzzzz99" alt="">');
  for (const refused of ['data:', 'javascript:', 'http://i.example', '//host.example', 'none']) expect(saved).not.toContain(refused);
  expect(saved.match(/<img /g)).toHaveLength(4);
});

it('a pasted image inside a link or bold is kept without the mark (a document image carries none)', () => {
  const page = checked();
  const html = '<p><a href="https://e.example"><img src="https://b.example/b.svg" alt="badge"></a> <strong>bold <img src="ref:abcdef12" alt="s"></strong></p>';
  page.editor.view.dispatch(page.editor.view.state.tr.setSelection(TextSelection.atEnd(page.editor.view.state.doc)));
  page.editor.view.pasteHTML(html, clipboard('', html));
  const marked: string[][] = [];
  page.editor.view.state.doc.descendants(node => { if (node.type.name === 'image') marked.push(node.marks.map(mark => mark.type.name)); });
  expect(marked).toEqual([[], [], [], []]);
  const { live } = page.saveNow();
  expect(live).toContain('<img src="https://b.example/b.svg" alt="badge"> <strong>bold </strong><img src="ref:abcdef12" alt="s">');
});

it('a pasted image keeps a title only up to the 512 characters the document stores', () => {
  const page = checked();
  const html = `<p><img src="ref:abcdef12" alt="t" title="${'t'.repeat(600)}"></p>`;
  page.editor.view.pasteHTML(html, clipboard('', html));
  expect(images(page.editor).find(image => (image as { afId: unknown }).afId === null)).toMatchObject({ title: 't'.repeat(512) });
  expect(() => page.saveNow()).not.toThrow();
});

it('copying an image and pasting it back keeps its stored source, not the address it is shown at, under a new id', () => {
  const page = checked();
  const { view } = page.editor;
  // The paragraph's first image (after "See ") as a node selection, copied as the browser would.
  let at = -1;
  view.state.doc.descendants((node, pos) => { if (at < 0 && node.type.name === 'image') at = pos; });
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
  const copied = view.serializeForClipboard(view.state.selection.content()).dom.innerHTML;
  expect(copied).toContain('src="/a/abcdef12/raw?v=3"');
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  view.pasteHTML(copied, clipboard('', copied));
  expect(images(page.editor)).toEqual([
    { src: 'ref:abcdef12', alt: 'Chart', title: 'T', afId: 'i1' },
    { src: 'https://i.example/p.png', alt: '', title: null, afId: 'i2' },
    { src: 'ref:abcdef12', alt: 'Chart', title: 'T', afId: null },
  ]);
  const { saved } = page.saveNow();
  expect(saved.match(/src="ref:abcdef12"/g)).toHaveLength(2);
  expect(new Set(saved.match(/data-af-id="[^"]+"/g)).size).toBe(saved.match(/data-af-id="[^"]+"/g)!.length);
});

it('the image command inserts an image by address at the caret, and refuses a source a document may not hold or a code block', () => {
  const page = checked();
  const { editor } = page;
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
  for (const src of ['javascript:alert(1)', 'data:image/png;base64,AA', 'http://i.example/p.png', '', '  ']) expect(editor.command('image', { src, alt: 'x' }), src).toBe(false);
  expect(editor.command('image', {})).toBe(false);
  expect(editor.command('image', { src: '  https://i.example/new.png ', alt: ' A  new\nchart ' })).toBe(true);
  expect(images(editor).at(-1)).toEqual({ src: 'https://i.example/new.png', alt: 'A new chart', title: null, afId: null });
  expect(page.saveNow().live).toBe(SAVED.replace('</p>', '<img src="https://i.example/new.png" alt="A new chart"></p>'));
  const code = mount('', () => {}, '<pre data-af-id="c"><code>x</code></pre>');
  code.editor.view.dispatch(code.editor.view.state.tr.setSelection(TextSelection.atEnd(code.editor.view.state.doc)));
  expect(code.editor.command('image', { src: 'https://i.example/new.png' })).toBe(false);
  expect(images(code.editor)).toEqual([]);
});

it('an external image no served address covers shows through the page\'s first-view door, not its own host', () => {
  const { editor, root } = mount('', () => {}, SAVED, 'page01');
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
  expect(editor.command('image', { src: 'https://i.example/new.png', alt: 'n' })).toBe(true);
  expect([...root.querySelectorAll('img:not(.ProseMirror-separator)')].map(img => img.getAttribute('src'))).toEqual([
    '/a/abcdef12/raw', '/a/page01/assets?u=https%3A%2F%2Fi.example%2Fp.png', '/a/page01/assets?u=https%3A%2F%2Fi.example%2Fnew.png',
  ]);
});
