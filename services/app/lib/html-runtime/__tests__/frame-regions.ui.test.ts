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
import { createRegionState, openRegionDoc, regionHtml, regionText } from '../../live-regions';
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

function open({ live = LIVE, loads = { count: 0 }, pageId = undefined as string | undefined } = {}): Harness {
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
    pageId,
  });
  const { state } = createRegionState('rich', live);
  const server = openRegionDoc(state);
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
  const peer = openRegionDoc(Y.encodeStateAsUpdate(h.server), { clientId: clientID });
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
    h.root.insertAdjacentHTML('beforeend', '<p data-af-id="a9"><a href="/elsewhere">a link</a></p>');
    h.receive({ kind: 'regions-enabled', regionIds: ['r1', 'missing'] });
    // A press on a link in the region follows the link; it does not open the region.
    h.root.querySelector('a')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(h.posted).toEqual([]);
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
    const other = openRegionDoc(Y.encodeStateAsUpdate(h.server), { gc: true });
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
    const peer = openRegionDoc(Y.encodeStateAsUpdate(h.server), { gc: true });
    const resolved = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(atob(last.head), (ch) => ch.charCodeAt(0))), peer);
    expect(resolved?.index).toBe('Live'.length);
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    expect(h.posted.at(-1)).toEqual({ kind: 'region-blur' });
  });

  it('paints collaborators\' carets at their text offset, and moves them with remote text', async () => {
    const h = open();
    const editor = await session(h);
    editor.view.coordsAtPos = (pos: number) => ({ left: pos * 10, right: pos * 10, top: 20, bottom: 36 });
    const peer = openRegionDoc(Y.encodeStateAsUpdate(h.server), { gc: true });
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
    // The caret overlay is outside the editable element, and page observers know it as the frame's own.
    expect(h.root.contains(caret())).toBe(false);
    expect(h.regions.ownsOverlay(caret()!)).toBe(true);
    expect(h.regions.ownsOverlay(h.root)).toBe(false);
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

/** The keys' input the frame puts the focus in while a region's editor loads. */
const keysInput = () => document.querySelector<HTMLTextAreaElement>('textarea[data-af="region-keys"]');
/** A real key as a browser delivers it to that input: keydown, then (unless it was taken) the text and its input event. */
function key(input: HTMLTextAreaElement, name: string, init: KeyboardEventInit = {}) {
  const down = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(down);
  if (down.defaultPrevented || name.length !== 1 || init.ctrlKey || init.metaKey) return;
  input.value += name;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: name }));
}
const typeKeys = (input: HTMLTextAreaElement, text: string) => { for (const character of Array.from(text)) key(input, character); };
/** A composition in that input, as an IME drives it: each step replaces the composing text. */
function compose(input: HTMLTextAreaElement, steps: string[], commit?: string) {
  const before = input.value;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  for (const step of steps) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    input.value = before + step;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: step, isComposing: true }));
  }
  if (commit === undefined) return;
  input.value = before + commit;
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: commit }));
  // Firefox's order: the input event after compositionend.
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: commit }));
}
/** Pressing the region the way a browser does: pointerdown, then the press focuses the region (it is a tab stop). */
function press(h: Harness) {
  h.root.querySelector('p')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  h.root.focus();
}

describe('keys typed between the press and the editor', () => {
  it('fetches the editor at the press, holds fast typing in order — Enter and Backspace too — and replays it into the editor when it mounts', async () => {
    const loads = { count: 0 };
    const h = open({ loads });
    h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    press(h);
    expect(h.posted).toEqual([{ kind: 'region-open', regionId: 'r1' }]);
    const input = keysInput()!;
    expect(document.activeElement).toBe(input);
    // Outside the page's body: neither the live morph nor page observers see it.
    expect(document.body.contains(input)).toBe(false);
    expect(h.regions.ownsOverlay(input)).toBe(true);
    typeKeys(input, 'Hi');
    key(input, 'Backspace');
    typeKeys(input, '!');
    key(input, 'Enter');
    typeKeys(input, 'Next ');
    key(input, 'b', { ctrlKey: true });
    typeKeys(input, 'bold');
    expect(texts(h.root)).toEqual(['Saved text.']);
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
    await settle();
    expect(h.editors).toHaveLength(1);
    expect(loads.count).toBe(1);
    expect(texts(h.root)).toEqual(['H!', 'Next boldLive text', 'Second']);
    // The editor has the focus the keys' input had.
    expect(h.editors[0]!.view.hasFocus()).toBe(true);
    expect(h.root.querySelector('strong')?.textContent).toBe('bold');
    expect(keysInput()).toBeNull();
    // The replay is ordinary typing: it goes to the server like any other.
    await sleep(REGION_BATCH_MS + 30);
    Y.applyUpdate(h.server, h.updates().at(-1)!.update);
    expect(serverHtml(h)).toBe('<p>H!</p><p data-af-id="a1">Next <strong>bold</strong>Live text</p><p data-af-id="a2">Second</p>');
  });

  it('lets an IME composition open when the editor is ready finish first, and takes its text exactly once', async () => {
    const h = open();
    h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    press(h);
    const input = keysInput()!;
    typeKeys(input, 'a');
    compose(input, ['k', 'か', 'かn', 'かな']);
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
    await settle();
    // Mounting now would end the composition: the editor waits for it.
    expect(h.editors).toHaveLength(0);
    expect(keysInput()).toBe(input);
    input.value = 'かな';
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'かな' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'かな' }));
    await settle();
    expect(h.editors).toHaveLength(1);
    expect(texts(h.root)[0]).toBe('aかなLive text');
  });

  it('commits a composition that ended before the editor, once, between the keys around it', async () => {
    const h = open();
    h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    press(h);
    const input = keysInput()!;
    typeKeys(input, 'x');
    compose(input, ['か', 'かな'], '仮名');
    key(input, 'Enter');
    typeKeys(input, 'y');
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
    await settle();
    expect(texts(h.root)).toEqual(['x仮名', 'yLive text', 'Second']);
  });

  it('a reader (never told a region is editable): a press and keys ask for nothing, hold nothing and change nothing, at once', async () => {
    const loads = { count: 0 };
    const h = open({ loads });
    for (const enabled of [null, []] as const) {
      if (enabled) h.receive({ kind: 'regions-enabled', regionIds: [...enabled] });
      press(h);
      h.root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      for (const name of [...'viewer keys', 'Enter', 'Backspace']) {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
      }
      // All of it is decided at the press: nothing was asked for, so nothing can arrive later.
      expect(h.posted).toEqual([]);
      expect(keysInput()).toBeNull();
      expect(h.root.hasAttribute('tabindex')).toBe(false);
      expect(h.root.hasAttribute('contenteditable')).toBe(false);
      expect(texts(h.root)).toEqual(['Saved text.']);
    }
    await settle();
    expect(loads.count).toBe(0);
    expect(h.editors).toHaveLength(0);
  });

  it('drops what was held when the session is refused, and leaves no input behind', async () => {
    const h = open();
    h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    press(h);
    typeKeys(keysInput()!, 'lost');
    h.receive({ kind: 'region-closed', regionId: 'r1', reason: 'refused' });
    expect(keysInput()).toBeNull();
    await settle();
    expect(h.editors).toHaveLength(0);
    expect(texts(h.root)).toEqual(['Saved text.']);
  });

  it('a doc opened with no press (the parent\'s auto-open): `focus` before the session and the editor holds the keys, then puts the caret at the start and types them there', async () => {
    const h = open();
    h.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    // The focus comes before the session (the parent opens it meanwhile); a focus for a region not enabled does nothing.
    h.receive({ kind: 'region-command', regionId: 'other', name: 'focus' });
    expect(keysInput()).toBeNull();
    h.receive({ kind: 'region-command', regionId: 'r1', name: 'focus' });
    expect(h.posted).toEqual([]);
    const input = keysInput()!;
    expect(document.activeElement).toBe(input);
    typeKeys(input, 'My ');
    h.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(h.server), seq: 3 });
    typeKeys(input, 'title');
    key(input, 'Enter');
    typeKeys(input, 'x');
    await settle();
    expect(h.editors).toHaveLength(1);
    expect(texts(h.root)).toEqual(['My title', 'xLive text', 'Second']);
    expect(h.editors[0]!.view.hasFocus()).toBe(true);
    expect(keysInput()).toBeNull();
  });
});

describe('the focus coming back from the page', () => {
  it('the editor that had the focus takes it as soon as the frame gets it back at its body, before any command', async () => {
    const h = open();
    const editor = await session(h);
    expect(editor.view.hasFocus()).toBe(true);
    // The page's slash menu or link dialog took the focus; the frame has it back at its body.
    (document.activeElement as HTMLElement).blur();
    expect(editor.view.hasFocus()).toBe(false);
    window.dispatchEvent(new FocusEvent('focus'));
    expect(editor.view.hasFocus()).toBe(true);
    // Not when the person put the focus somewhere else in the page.
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();
    window.dispatchEvent(new FocusEvent('focus'));
    expect(document.activeElement).toBe(field);
  });
});

describe('the editor\'s toolbar, menu and shortcut commands', () => {
  const keyDown = (editor: RegionEditor, init: KeyboardEventInit) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const blocks = (root: Element) => [...root.children].map((child) => `${child.tagName.toLowerCase()}${child.getAttribute('data-list') ? `[${child.getAttribute('data-list')}]` : ''}${child.hasAttribute('data-quote') ? '[quote]' : ''}:${child.textContent}`);

  it('the slash menu\'s commands: removeSlash takes the `/` that opens the caret\'s block only, rule draws a divider, paragraph undoes a code block', async () => {
    const h = open();
    const editor = await session(h);
    select(editor, 1 + 'Live'.length);
    expect(editor.command('removeSlash')).toBe(false);
    const end = editor.view.state.doc.content.size;
    editor.view.dispatch(editor.view.state.tr.insert(end, editor.view.state.schema.nodes.textblock!.create()));
    select(editor, end + 1);
    typeInto(editor, '/');
    // Keys typed right after the choice may reach the text before the command does.
    typeInto(editor, 'ab');
    expect(editor.command('removeSlash')).toBe(true);
    expect(texts(h.root)).toEqual(['Live text', 'Second', 'ab']);
    expect(editor.command('removeSlash')).toBe(false);
    editor.view.dispatch(editor.view.state.tr.delete(editor.view.state.selection.head - 2, editor.view.state.selection.head));
    expect(editor.command('heading', { level: 2 })).toBe(true);
    expect(h.root.lastElementChild!.tagName).toBe('H2');
    expect(editor.command('rule')).toBe(true);
    expect([...h.root.children].map((child) => child.tagName)).toEqual(['P', 'P', 'HR', 'H2']);
    typeInto(editor, 'x');
    expect(h.root.lastElementChild!.textContent).toBe('x');
    expect(editor.command('codeBlock', { on: true })).toBe(true);
    expect(h.root.lastElementChild!.tagName).toBe('PRE');
    expect(editor.command('paragraph')).toBe(true);
    expect(h.root.lastElementChild!.outerHTML).toBe('<p>x</p>');
    // Back to the text: the caret stays; `focus` (a doc opened without a press) takes it to the start.
    const at = editor.view.state.selection.head;
    expect(editor.command('resume')).toBe(true);
    expect(editor.view.state.selection.head).toBe(at);
    expect(editor.command('focus')).toBe(true);
    expect(editor.view.state.selection.head).toBe(1);
    expect(editor.view.hasFocus()).toBe(true);
  });

  it('link: an empty caret inserts the URL as linked text, a caret on a link changes or removes it, an unsafe URL changes nothing', async () => {
    const h = open();
    const editor = await session(h);
    select(editor, 1 + 'Live '.length);
    expect(editor.command('link', { href: 'javascript:alert(1)' })).toBe(false);
    expect(editor.command('link', { href: null })).toBe(false);
    expect(editor.command('link', { href: 'https://a.example/' })).toBe(true);
    expect(h.root.firstElementChild!.innerHTML).toBe('Live <a href="https://a.example/">https://a.example/</a>text');
    // Typing after the link is not part of it.
    typeInto(editor, '!');
    expect(h.root.firstElementChild!.innerHTML).toBe('Live <a href="https://a.example/">https://a.example/</a>!text');
    select(editor, 1 + 'Live https'.length);
    expect(editor.command('link', { href: '/inside' })).toBe(true);
    expect(h.root.firstElementChild!.innerHTML).toBe('Live <a href="/inside">https://a.example/</a>!text');
    expect(editor.command('link', { href: null })).toBe(true);
    expect(h.root.firstElementChild!.innerHTML).toBe('Live https://a.example/!text');
  });

  it('Mod-K asks the parent for a link with the one at the caret; Mod-Alt-1..3, Mod-Shift-7/8/9 toggle headings, lists and quote', async () => {
    const h = open();
    const editor = await session(h);
    select(editor, 1 + 'Live'.length);
    keyDown(editor, { key: 'k', ctrlKey: true });
    expect(h.posted.at(-1)).toEqual({ kind: 'region-link', regionId: 'r1', href: null });
    editor.command('link', { href: 'https://b.example/' });
    select(editor, 1 + 'Live'.length + 3);
    keyDown(editor, { key: 'k', ctrlKey: true });
    expect(h.posted.at(-1)).toEqual({ kind: 'region-link', regionId: 'r1', href: 'https://b.example/' });
    select(editor, 2);
    keyDown(editor, { key: '2', code: 'Digit2', keyCode: 50, ctrlKey: true, altKey: true });
    expect(h.root.firstElementChild!.tagName).toBe('H2');
    keyDown(editor, { key: '2', code: 'Digit2', keyCode: 50, ctrlKey: true, altKey: true });
    expect(h.root.firstElementChild!.tagName).toBe('P');
    // Shifted digits arrive as their symbol: the key code names the digit.
    keyDown(editor, { key: '*', code: 'Digit8', keyCode: 56, ctrlKey: true, shiftKey: true });
    expect(blocks(h.root)[0]).toMatch(/^p\[bullet\]:/);
    keyDown(editor, { key: '&', code: 'Digit7', keyCode: 55, ctrlKey: true, shiftKey: true });
    expect(blocks(h.root)[0]).toMatch(/^p\[ordered\]:/);
    keyDown(editor, { key: '&', code: 'Digit7', keyCode: 55, ctrlKey: true, shiftKey: true });
    expect(blocks(h.root)[0]).toMatch(/^p:/);
    keyDown(editor, { key: '(', code: 'Digit9', keyCode: 57, ctrlKey: true, shiftKey: true });
    expect(blocks(h.root)[0]).toMatch(/^p\[quote\]:/);
    keyDown(editor, { key: '(', code: 'Digit9', keyCode: 57, ctrlKey: true, shiftKey: true });
    expect(blocks(h.root)[0]).toMatch(/^p:/);
  });
});

describe('a rebuild under an editor (a version not drawn in place)', () => {
  it('keeps the caret: the next document opens the region again, the caret where it was, and keys typed meanwhile land there', async () => {
    const before = open({ pageId: 'pg1' });
    const editor = await session(before);
    const { view } = editor;
    let at = -1;
    view.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text!.includes('Live text')) at = pos + 'Live te'.length; });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    view.focus();
    before.regions.keepForRebuild();
    before.regions.dispose();
    harness = null;
    // The rebuilt document: no press, no parent focus command.
    const after = open({ pageId: 'pg1' });
    after.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    expect(after.posted).toContainEqual({ kind: 'region-open', regionId: 'r1' });
    const keys = document.querySelector<HTMLTextAreaElement>('textarea[data-af="region-keys"]')!;
    expect(document.activeElement).toBe(keys);
    keys.value = 'Z';
    keys.dispatchEvent(new InputEvent('input', { bubbles: true }));
    // The same server: its state holds the shared text the kept positions point into.
    after.receive({ kind: 'region-session', regionId: 'r1', regionKind: 'rich', clientId: CLIENT, state: Y.encodeStateAsUpdate(before.server), seq: 3 });
    await settle();
    const reopened = after.editors[0]!;
    expect(reopened.view.hasFocus()).toBe(true);
    expect(reopened.view.state.doc.textContent).toContain('Live teZxt');
    // Kept once: a later document of this page starts with no caret.
    after.regions.dispose();
    harness = null;
    const later = open({ pageId: 'pg1' });
    later.receive({ kind: 'regions-enabled', regionIds: ['r1'] });
    expect(later.posted).not.toContainEqual({ kind: 'region-open', regionId: 'r1' });
  });
});
