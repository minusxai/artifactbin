/**
 * The document editor and native-v1's image node (lib/live-regions native-schema.ts): an editor that loads a document
 * holding an image keeps it (an editor whose schema could not build it would delete it from the shared document),
 * shows the address the served page gave it, saves it, and creates no image of its own from a paste.
 */
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '../../html-page';
import { compactRegion, createRegionState, regionHtml, validateRegionUpdate } from '../../live-regions';
import { mountRegionEditor } from '../native-region-editor';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
const kind = 'rich-native-v1';
const SAVED = '<p data-af-id="p1">See <img data-af-id="i1" src="ref:abcdef12" alt="Chart" title="T"> and <img data-af-id="i2" src="https://i.example/p.png" alt=""></p>';
const SERVED = '<p data-af-id="p1">See <img data-af-id="i1" src="/a/abcdef12/raw?v=3" alt="Chart" title="T"> and <img data-af-id="i2" src="/a/page01/assets?u=https%3A%2F%2Fi.example%2Fp.png" alt=""></p>';

function mount(served: string, post: (update: Uint8Array) => void = () => {}) {
  const initial = createRegionState(kind, SAVED);
  const root = document.createElement('article');
  root.innerHTML = served;
  document.body.append(root);
  const editor = mountRegionEditor({ win: window, root, regionId: 'doc', kind, clientId: 801, state: initial.state, post(message) { if (message.kind === 'region-update') post(message.update); } });
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

it('an HTML paste builds no image node, even of an image the document holds', () => {
  const { editor } = mount(SERVED);
  const html = '<p>pasted <img src="https://i.example/new.png" alt="new"> <img data-af-id="i1" src="ref:abcdef12" alt="Chart"></p>';
  editor.view.pasteHTML(html, clipboard('pasted', html));
  expect(editor.view.state.doc.textContent).toContain('pasted');
  expect(images(editor)).toHaveLength(2);
});
