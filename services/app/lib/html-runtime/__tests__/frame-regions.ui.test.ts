// @vitest-environment jsdom
/**
 * The page frame's half of live region editing, end to end inside one jsdom document: the eager handler
 * (frame-regions) with the REAL lazily loaded editor (region-editor), against a fake parent that records what the
 * frame posts and a "server" that is only Yjs bytes (createRegionState, regionHtml). No endpoint exists here: the wire
 * is the contract's RegionParentMessage / RegionFrameMessage, exactly.
 */
import type { RegionFrameMessage, RegionParentMessage } from '@artifactbin/contracts';
import { TextSelection } from 'prosemirror-state';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { installEditorGeometry } from '../../../test/setup/editor-geometry';
import { createRegionState, regionHtml, regionText } from '../../live-regions';
import { startFrameRegions, type FrameRegions } from '../frame-regions';
import { applyHtmlVersion, LOADED_SOURCE } from '../live-morph';
import { REGION_BATCH_MS, type RegionEditor } from '../region-editor';
import { encodePosition } from '../../html-bridge/region-carets';

let restoreGeometry: () => void;
beforeAll(() => { restoreGeometry = installEditorGeometry(); });
afterAll(() => restoreGeometry());

const CLIENT = 4242;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await sleep(0); };

/** The region as saved (what readers see) and the live text the server's state holds (unsaved typing included). */
const SAVED = '<p data-af-id="a1">Saved text.</p>';
const LIVE = '<p data-af-id="a1">Live text</p><p data-af-id="a2">Second</p>';

interface Harness {
  regions: FrameRegions;
  posted: (RegionFrameMessage | { kind: 'error'; message: string })[];
  editors: RegionEditor[];
  /** The server's merged state: every update the frame posted is applied here. */
  server: Y.Doc;
  root: HTMLElement;
  receive(message: RegionParentMessage): void;
  updates(): Extract<RegionFrameMessage, { kind: 'region-update' }>[];
}
let harness: Harness | null = null;
afterEach(() => {
  harness?.regions.dispose();
  harness = null;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as Record<symbol, unknown>)[LOADED_SOURCE];
});

function page(region = SAVED) {
  document.body.innerHTML = `<header><h1 data-af-id="t">Plan</h1></header><article data-af-id="r1" data-af-editable="rich" class="notes">${region}</article><p data-af-id="after">Outside</p>`;
  return document.querySelector('article')!;
}

function open({ live = LIVE, loads = { count: 0 } } = {}): Harness {
  const root = page();
  const posted: Harness['posted'] = [];
  const editors: RegionEditor[] = [];
  const regions = startFrameRegions({
    win: window,
    post: (message) => posted.push(message),
    load: async () => {
      loads.count++;
      const module = await import('../region-editor');
      return { mountRegionEditor: (options) => { const editor = module.mountRegionEditor(options); editors.push(editor); return editor; } };
    },
  });
  const { state } = createRegionState('rich', live);
  const server = new Y.Doc({ gc: false });
  Y.applyUpdate(server, state);
  harness = {
    regions, posted, editors, server, root,
    receive: (message) => { expect(regions.receive(message)).toBe(true); },
    updates: () => posted.filter((message): message is Extract<RegionFrameMessage, { kind: 'region-update' }> => message.kind === 'region-update'),
  };
  return harness;
}
/** The frame is enabled, the person presses the region, the parent answers with the session. */
async function session(h: Harness) {
  h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
  h.root.querySelector('p')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  expect(h.posted).toContainEqual({ kind: 'region-open', regionId: 'r1' });
  h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
  await settle();
  expect(h.editors).toHaveLength(1);
  return h.editors[0]!;
}
/** A collaborator's change, as the server would relay it. */
function peerEdit(h: Harness, change: (text: Y.Text) => void, clientID = 99): Uint8Array {
  const peer = new Y.Doc({ gc: false });
  peer.clientID = clientID;
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(h.server));
  const before = Y.encodeStateVector(peer);
  change(regionText(peer));
  const update = Y.encodeStateAsUpdate(peer, before);
  Y.applyUpdate(h.server, update);
  return update;
}
const typeInto = (editor: RegionEditor, text: string) => {
  const { view } = editor;
  for (const character of Array.from(text)) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
};
const select = (editor: RegionEditor, pos: number) => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, pos)));
const texts = (root: Element) => [...root.children].map((child) => child.textContent);
const serverHtml = (h: Harness) => regionHtml('rich', Y.encodeStateAsUpdate(h.server));

describe('a region session in the page frame', () => {
  it('fetches the editor only for a session, and mounts it IN PLACE on the region element with the session\'s text', async () => {
    const loads = { count: 0 };
    const h = open({ loads });
    h.receive({ kind: 'regions-enabled', regionIds: ['r1', 'missing'] });
    // Enabled and asked for, but no session yet: no editor bytes.
    h.root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(h.posted).toEqual([{ kind: 'region-open', regionId: 'r1' }]);
    expect(loads.count).toBe(0);
    expect(h.root.getAttribute('tabindex')).toBe('0');
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
    await settle();
    expect(loads.count).toBe(1);
    expect(document.querySelector('article')).toBe(h.root);
    expect(h.root.getAttribute('contenteditable')).toBe('true');
    expect(h.root.getAttribute('data-af-region-editor')).toBe('rich');
    expect(h.root.classList.contains('notes')).toBe(true);
    expect(texts(h.root)).toEqual(['Live text', 'Second']);
    expect(document.head.querySelector('style[data-af="region-editor"]')!.textContent).toContain('[data-af-region-editor]>[data-list="ordered"][data-depth="2"]');
    // Everything outside the region is untouched.
    expect(document.querySelector('[data-af-id="after"]')!.textContent).toBe('Outside');
  });

  it('refuses a session for a region that is not declared, or declared with another kind', async () => {
    const loads = { count: 0 };
    const h = open({ loads });
    h.receive({ kind: 'region-session', regionId: 'nope', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 1 });
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'text', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 1 });
    await settle();
    expect(loads.count).toBe(0);
    expect(h.root.hasAttribute('contenteditable')).toBe(false);
    // Not a region message at all: left to the bridge.
    expect(h.regions.receive({ kind: 'send' })).toBe(false);
  });

  it('sends local typing as one merged region-update per 50 ms, written only with the session\'s client id, that the server applies to the same text', async () => {
    const h = open();
    const editor = await session(h);
    select(editor, 1 + 'Live text'.length);
    typeInto(editor, '!!');
    select(editor, 1);
    typeInto(editor, '>');
    expect(h.updates()).toHaveLength(0);
    await sleep(REGION_BATCH_MS + 30);
    const sent = h.updates();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.regionId).toBe('r1');
    expect(sent[0]!.update).toBeInstanceOf(Uint8Array);
    // The server refuses foreign client ids: every struct is this session's.
    const decoded = Y.decodeUpdate(sent[0]!.update);
    expect(decoded.structs.length).toBeGreaterThan(0);
    expect(new Set(decoded.structs.map((struct) => struct.id.client))).toEqual(new Set([CLIENT]));
    Y.applyUpdate(h.server, sent[0]!.update);
    expect(serverHtml(h)).toBe('<p data-af-id="a1">&gt;Live text!!</p><p data-af-id="a2">Second</p>');
    // A second Y.Doc started from the same bytes converges on the same text.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(h.server));
    expect(regionText(other).toString()).toBe(regionText(h.server).toString());
  });

  it('applies region-remote updates to the DOM, keeps the caret on its character, and tolerates duplicates', async () => {
    const h = open();
    const editor = await session(h);
    select(editor, 1 + 'Live'.length);
    const update = peerEdit(h, (text) => text.insert(0, 'Hi '));
    h.receive({ kind: 'region-remote', regionId: 'r1', updates: [update], seq: 4 });
    expect(texts(h.root)).toEqual(['Hi Live text', 'Second']);
    expect(editor.view.state.selection.head).toBe(1 + 'Hi Live'.length);
    // A resend (reconnect) or an echo changes nothing.
    h.receive({ kind: 'region-remote', regionId: 'r1', updates: [update, update], seq: 4 });
    h.receive({ kind: 'region-ack', regionId: 'r1', seq: 4 });
    expect(texts(h.root)).toEqual(['Hi Live text', 'Second']);
    await sleep(REGION_BATCH_MS + 30);
    expect(h.updates()).toHaveLength(0);
  });

  it('holds remote updates and sends nothing while an IME composition is open, then applies and sends after compositionend', async () => {
    const h = open();
    const editor = await session(h);
    select(editor, 1 + 'Live text'.length);
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(editor.view.composing).toBe(true);
    const at = editor.view.state.selection.from;
    for (const [composed, length] of [['k', 0], ['か', 1], ['かn', 1], ['かな', 2]] as const) editor.view.dispatch(editor.view.state.tr.insertText(composed, at, at + length));
    const update = peerEdit(h, (text) => text.insert(0, 'Hi '));
    h.receive({ kind: 'region-remote', regionId: 'r1', updates: [update], seq: 4 });
    // Held: the composed text is not disturbed and no partial composition leaves the frame.
    expect(texts(h.root)[0]).toBe('Live textかな');
    await sleep(REGION_BATCH_MS + 30);
    expect(h.updates()).toHaveLength(0);
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'かな' }));
    await sleep(REGION_BATCH_MS + 60);
    expect(editor.view.composing).toBe(false);
    expect(texts(h.root)[0]).toBe('Hi Live textかな');
    const sent = h.updates();
    expect(sent).toHaveLength(1);
    Y.applyUpdate(h.server, sent[0]!.update);
    expect(serverHtml(h)).toBe('<p data-af-id="a1">Hi Live textかな</p><p data-af-id="a2">Second</p>');
  });

  it('region-closed unmounts the editor and puts back the saved HTML of the newest version this document drew', async () => {
    const h = open();
    const editor = await session(h);
    const ownAttributes = ['class', 'data-af-editable', 'data-af-id', 'tabindex'];
    typeInto(editor, 'x');
    (window as unknown as Record<symbol, unknown>)[LOADED_SOURCE] = `<!doctype html><html><body><article data-af-id="r1" data-af-editable="rich" class="notes"><p data-af-id="a1">Saved by flush.</p></article></body></html>`;
    h.receive({ kind: 'region-closed', regionId: 'r1', reason: 'removed' });
    expect(document.querySelector('article')).toBe(h.root);
    expect(h.root.innerHTML).toBe('<p data-af-id="a1">Saved by flush.</p>');
    expect([...h.root.attributes].map((attr) => attr.name).sort()).toEqual(ownAttributes);
    expect(editor.view.isDestroyed).toBe(true);
    // Without a kept source, what the region showed before the editor took it.
    delete (window as unknown as Record<symbol, unknown>)[LOADED_SOURCE];
    h.root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
    await settle();
    expect(texts(h.root)).toEqual(['Live text', 'Second']);
    h.receive({ kind: 'region-closed', regionId: 'r1', reason: 'access' });
    expect(h.root.innerHTML).toBe('<p data-af-id="a1">Saved by flush.</p>');
  });

  it('queues what arrives while the editor loads, and merges a repeat session in place with the new client id', async () => {
    const h = open();
    h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    const start = Y.encodeStateAsUpdate(h.server);
    const remote = peerEdit(h, (text) => text.insert(0, 'Hi '));
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: start, seq: 3 });
    h.receive({ kind: 'region-remote', regionId: 'r1', updates: [remote], seq: 4 });
    h.receive({ kind: 'region-command', regionId: 'r1', name: 'heading', args: { level: 2 } });
    await settle();
    expect(h.root.firstElementChild!.outerHTML).toBe('<h2 data-af-id="a1">Hi Live text</h2>');
    const editor = h.editors[0]!;
    // The stream reset: a new session for the mounted region merges, never remounts.
    const later = peerEdit(h, (text) => text.insert(text.length - 1, ' end'));
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT + 1, state: Y.encodeStateAsUpdate(h.server), seq: 9 });
    void later;
    expect(h.editors).toHaveLength(1);
    expect(texts(h.root)).toEqual(['Hi Live text', 'Second end']);
    await sleep(REGION_BATCH_MS + 30);
    h.posted.length = 0;
    select(editor, 1);
    typeInto(editor, 'Z');
    await sleep(REGION_BATCH_MS + 30);
    expect(new Set(Y.decodeUpdate(h.updates()[0]!.update).structs.map((struct) => struct.id.client))).toEqual(new Set([CLIENT + 1]));
  });

  it('runs region-command, and says region-slash with the caret place for "/" at the start of an empty block only', async () => {
    const h = open();
    const editor = await session(h);
    editor.view.coordsAtPos = (pos: number) => ({ left: pos * 10, right: pos * 10, top: 100, bottom: 118 });
    h.receive({ kind: 'region-command', regionId: 'r1', name: 'list', args: { type: 'ordered' } });
    expect(h.root.firstElementChild!.getAttribute('data-list')).toBe('ordered');
    h.receive({ kind: 'region-command', regionId: 'r1', name: 'nonsense' });
    select(editor, 1 + 'Live text'.length);
    typeInto(editor, '/');
    expect(h.posted.some((message) => message.kind === 'region-slash')).toBe(false);
    const end = editor.view.state.doc.content.size;
    editor.view.dispatch(editor.view.state.tr.insert(end, editor.view.state.schema.nodes.textblock!.create()));
    select(editor, end + 1);
    typeInto(editor, '/');
    expect(h.posted.filter((message) => message.kind === 'region-slash')).toEqual([{ kind: 'region-slash', regionId: 'r1', x: (end + 1) * 10, y: 118 }]);
    expect(texts(h.root).at(-1)).toBe('/');
  });

  it('posts this editor\'s caret as relative positions with its marks and block, and region-blur when it leaves', async () => {
    const h = open();
    const editor = await session(h);
    h.posted.length = 0;
    editor.view.dom.dispatchEvent(new FocusEvent('focus'));
    select(editor, 1 + 'Live'.length);
    await sleep(5);
    const carets = h.posted.filter((message): message is Extract<RegionFrameMessage, { kind: 'region-caret' }> => message.kind === 'region-caret');
    const last = carets.at(-1)!;
    expect(last).toMatchObject({ regionId: 'r1', marks: [], block: 'paragraph' });
    expect(atob(last.head).length).toBeLessThanOrEqual(256);
    // The position is the shared text's: a peer resolves it to the same character.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(h.server));
    const resolved = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(atob(last.head), (ch) => ch.charCodeAt(0))), peer);
    expect(resolved?.index).toBe('Live'.length);
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    expect(h.posted.at(-1)).toEqual({ kind: 'region-blur' });
  });

  it('paints collaborators\' carets at their text offset, and moves them with remote text', async () => {
    const h = open();
    const editor = await session(h);
    editor.view.coordsAtPos = (pos: number) => ({ left: pos * 10, right: pos * 10, top: 20, bottom: 36 });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(h.server));
    const at = (index: number) => btoa(String.fromCharCode(...Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(regionText(peer), index))));
    h.receive({ kind: 'region-paint', carets: [
      { regionId: 'r1', anchor: at(4), head: at(4), id: 'u2', label: 'Ana' },
      { regionId: 'other', anchor: at(1), head: at(1), id: 'u3', label: 'Elsewhere' },
      { regionId: 'r1', anchor: 'not base64!', head: 'not base64!', id: 'u4', label: 'Broken' },
    ] });
    const caret = () => document.querySelector<HTMLElement>('[data-af="region-carets"] [data-af-region-caret="u2"]');
    // Offset 4 is after "Live": document position 5.
    expect(caret()!.style.left).toBe('50px');
    expect(caret()!.style.top).toBe('20px');
    expect(caret()!.textContent).toBe('Ana');
    expect(document.querySelectorAll('[data-af-region-caret]')).toHaveLength(1);
    // The caret overlay is outside the editable element.
    expect(h.root.contains(caret())).toBe(false);
    h.receive({ kind: 'region-remote', regionId: 'r1', updates: [peerEdit(h, (text) => text.insert(0, 'Hi '))], seq: 4 });
    expect(caret()!.style.left).toBe('80px');
    // The same position this editor would encode.
    expect(encodePosition(editor.view.state, 8)).toBeTypeOf('string');
    h.receive({ kind: 'region-paint', carets: [] });
    expect(caret()).toBeNull();
  });
});

describe('a saved version arriving while a region is edited', () => {
  const runtime = (revision: number, ids: string[]) => `<script type="application/json" data-af="runtime">${JSON.stringify({ revision: String(revision), savedNodeIds: ids, scriptFingerprint: 'fp' })}</script>`;
  const served = (revision: number, region: string, outside = 'Outside') => {
    const body = `<header data-af-id="hd"><h1 data-af-id="t">Plan</h1></header><article data-af-id="r1" data-af-editable="rich" class="notes">${region}</article><p data-af-id="after">${outside}</p>`;
    const ids = [...body.matchAll(/data-af-id="([^"]+)"/g)].map((match) => match[1]!);
    return `<!doctype html><html><head>${runtime(revision, ids)}</head><body>${body}</body></html>`;
  };

  it('does not refuse or rebuild: the editor keeps its element and text, the rest of the page and the revision advance', async () => {
    const h = open();
    const v1 = served(1, SAVED);
    (window as unknown as Record<symbol, unknown>)[LOADED_SOURCE] = v1;
    const editor = await session(h);
    select(editor, 3);
    const v2 = served(2, '<p data-af-id="a1">Saved by flush, with the live text.</p><p data-af-id="a3">New block</p>', 'Outside, edited');
    const applied = await applyHtmlVersion(window, { revision: '1' }, 2, (async () => new Response(v2)) as unknown as typeof fetch, h.regions.editing);
    expect(applied.rebuild).toBeUndefined();
    expect(applied.revision).toBe('2');
    expect(applied.savedNodeIds).toContain('a3');
    expect(document.querySelector('article')).toBe(h.root);
    expect(texts(h.root)).toEqual(['Live text', 'Second']);
    expect(editor.view.isDestroyed).toBe(false);
    expect(editor.view.state.selection.head).toBe(3);
    expect(document.querySelector('[data-af-id="after"]')!.textContent).toBe('Outside, edited');
    // Closing now shows that version's saved region.
    h.receive({ kind: 'region-closed', regionId: 'r1', reason: 'removed' });
    expect(texts(h.root)).toEqual(['Saved by flush, with the live text.', 'New block']);
  });
});
