// @vitest-environment jsdom
/**
 * `@afbin/collab` in the page frame (../collab-binding over ../frame-cells): a dataset text cell bound to inputs and
 * textareas, against a fake parent that speaks the contract's region messages under the cell key and a "server" that
 * is only Yjs bytes. Minimal diffs, the caret kept under remote edits, IME composition, duplicate and out-of-order
 * delivery, status, and the read-only answer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { cellKey, type RegionFrameMessage, type RegionParentMessage } from '@artifactbin/contracts';
import { createCellState, openRegionDoc } from '../../live-regions/cells';
import { createCellPort } from '../frame-cells';
import { createCollabText, mergeEarlyTyping, type CollabError, type CollabText } from '../collab-binding';

const KEY = cellKey({ dataset: 'tasks', rowId: 'r_abc', column: 'description' });
const CLIENT = 4242;

/** A frame with the cell port attached to a recording parent. */
function harness(options: { writable?: boolean } = {}) {
  const posted: RegionFrameMessage[] = [];
  const cells = createCellPort({ writable: options.writable ?? true });
  const frame = cells.attach((message) => posted.push(message));
  const say = (message: RegionParentMessage) => frame.receive(message as { kind: string; regionId?: unknown });
  /** The server's copy: the session state, then whatever peers and this client write. */
  const server = openRegionDoc();
  return { posted, cells, frame, say, server };
}
const texts: CollabText[] = [];
afterEach(() => { for (const text of texts.splice(0)) text.destroy(); document.body.replaceChildren(); });

function open(value: string, h = harness()) {
  const text = createCollabText(h.cells.port, KEY);
  texts.push(text);
  const initial = createCellState(value);
  Y.applyUpdate(h.server, initial.state);
  h.say({ kind: 'region-session', regionId: KEY, regionKind: 'text', clientId: CLIENT, state: initial.state, seq: 1 });
  return { ...h, text };
}
/** Another person's edit, made on a replica of the server, as the update the parent would relay. */
function peerEdit(server: Y.Doc, work: (text: Y.Text) => void, clientID = 99) {
  const peer = openRegionDoc(Y.encodeStateAsUpdate(server), { clientId: clientID });
  const before = Y.encodeStateVector(peer);
  work(peer.getText('region'));
  const update = Y.encodeStateAsUpdate(peer, before);
  Y.applyUpdate(server, update);
  return update;
}
const textarea = (value = '') => {
  const element = document.createElement('textarea');
  element.value = value;
  document.body.append(element);
  return element;
};
const type = (element: HTMLTextAreaElement | HTMLInputElement, value: string, caret = value.length) => {
  element.value = value;
  element.setSelectionRange(caret, caret);
  element.dispatchEvent(new InputEvent('input', { bubbles: true }));
};
const updatesOf = (posted: RegionFrameMessage[]) => posted.filter((message): message is Extract<RegionFrameMessage, { kind: 'region-update' }> => message.kind === 'region-update');

describe('binding an element', () => {
  it('opens the cell under its key and shows the server text once a session arrives', () => {
    const h = harness();
    const text = createCollabText(h.cells.port, KEY);
    texts.push(text);
    expect(h.posted).toEqual([{ kind: 'region-open', regionId: KEY }]);
    const element = textarea('stale');
    text.bind(element);
    expect(text.status).toBe('offline');
    const initial = createCellState('Fix the login bug');
    h.say({ kind: 'region-session', regionId: KEY, regionKind: 'text', clientId: CLIENT, state: initial.state, seq: 1 });
    expect(element.value).toBe('Fix the login bug');
    expect(text.value).toBe('Fix the login bug');
    expect(text.status).toBe('synced');
  });

  it('sends each input as its smallest splice under the session client id, and is pending until stored', () => {
    const { text, posted, say, server } = open('hello world');
    const element = textarea();
    text.bind(element);
    const changes: string[] = [];
    text.on('change', (value) => changes.push(value));
    type(element, 'hello brave world', 12);
    const [sent] = updatesOf(posted);
    expect(sent!.regionId).toBe(KEY);
    const decoded = Y.decodeUpdate(sent!.update);
    expect(decoded.structs.every((struct) => struct.id.client === CLIENT)).toBe(true);
    // One insertion of exactly what changed; nothing deleted.
    expect(decoded.structs.map((struct) => (struct as Y.Item).content.getContent().join(''))).toEqual(['brave ']);
    expect(decoded.ds.clients.size).toBe(0);
    Y.applyUpdate(server, sent!.update);
    expect(server.getText('region').toString()).toBe('hello brave world');
    expect(changes).toEqual(['hello brave world']);
    expect(text.status).toBe('pending');
    // An ack that settles fewer updates than were sent keeps it pending; one that covers them all syncs it.
    type(element, 'hello brave new world', 16);
    say({ kind: 'region-ack', regionId: KEY, seq: 3, settled: 1 });
    expect(text.status).toBe('pending');
    say({ kind: 'region-ack', regionId: KEY, seq: 4, settled: 2 });
    expect(text.status).toBe('synced');
  });

  it('keeps the caret on its text when another person edits before and after it', () => {
    const { text, say, server } = open('one two three');
    const element = textarea();
    text.bind(element);
    element.focus();
    // The caret sits after "two" (index 7), with "three" still to come.
    element.setSelectionRange(7, 7);
    say({ kind: 'region-remote', regionId: KEY, updates: [peerEdit(server, (t) => t.insert(0, 'zero '))], seq: 2 });
    expect(element.value).toBe('zero one two three');
    expect([element.selectionStart, element.selectionEnd]).toEqual([12, 12]);
    say({ kind: 'region-remote', regionId: KEY, updates: [peerEdit(server, (t) => t.insert(t.length, ' four'))], seq: 3 });
    expect(element.value).toBe('zero one two three four');
    expect([element.selectionStart, element.selectionEnd]).toEqual([12, 12]);
    // Text inserted exactly at the caret goes after it; a selection keeps its ends on its text.
    say({ kind: 'region-remote', regionId: KEY, updates: [peerEdit(server, (t) => t.insert(12, '!'))], seq: 4 });
    expect(element.value).toBe('zero one two! three four');
    expect(element.selectionStart).toBe(12);
    element.setSelectionRange(5, 8);
    say({ kind: 'region-remote', regionId: KEY, updates: [peerEdit(server, (t) => t.delete(0, 5))], seq: 5 });
    expect(element.value.slice(element.selectionStart!, element.selectionEnd!)).toBe('one');
  });

  it('waits out an IME composition: nothing is read or drawn mid-composition, then the composed text and the waiting edits merge', () => {
    const { text, posted, say, server } = open('abc');
    const element = textarea();
    text.bind(element);
    element.focus();
    element.dispatchEvent(new CompositionEvent('compositionstart'));
    // The IME shows an intermediate value: an input marked composing is not read.
    element.value = 'abcに';
    element.dispatchEvent(new InputEvent('input', { isComposing: true }));
    expect(updatesOf(posted)).toEqual([]);
    // A remote edit arriving now is not drawn into the composing element.
    say({ kind: 'region-remote', regionId: KEY, updates: [peerEdit(server, (t) => t.insert(0, 'X'))], seq: 2 });
    expect(element.value).toBe('abcに');
    element.value = 'abc日本';
    element.dispatchEvent(new CompositionEvent('compositionend', { data: '日本' }));
    expect(element.value).toBe('Xabc日本');
    expect(text.value).toBe('Xabc日本');
    for (const message of updatesOf(posted)) Y.applyUpdate(server, message.update);
    expect(server.getText('region').toString()).toBe('Xabc日本');
  });

  it('takes updates twice and out of order', () => {
    const { text, say, server } = open('base');
    const element = textarea();
    text.bind(element);
    const first = peerEdit(server, (t) => t.insert(4, ' one'));
    const second = peerEdit(server, (t) => t.insert(8, ' two'));
    say({ kind: 'region-remote', regionId: KEY, updates: [second], seq: 3 });
    expect(element.value).toBe('base');
    say({ kind: 'region-remote', regionId: KEY, updates: [first, first], seq: 2 });
    expect(element.value).toBe('base one two');
    say({ kind: 'region-remote', regionId: KEY, updates: [second, first], seq: 3 });
    expect(element.value).toBe('base one two');
  });

  it('draws into every bound element and a destroyed binding stops reading its element', () => {
    const { text, posted } = open('shared');
    const a = textarea(), b = document.createElement('input');
    document.body.append(b);
    const bound = text.bind(a);
    text.bind(b);
    expect(b.value).toBe('shared');
    type(a, 'shared!');
    expect(b.value).toBe('shared!');
    bound.destroy();
    type(a, 'ignored');
    expect(updatesOf(posted)).toHaveLength(1);
    expect(text.value).toBe('shared!');
  });
});

describe('typing before the first session', () => {
  const session = (h: ReturnType<typeof harness>, value: string) => {
    const initial = createCellState(value);
    Y.applyUpdate(h.server, initial.state);
    h.say({ kind: 'region-session', regionId: KEY, regionKind: 'text', clientId: CLIENT, state: initial.state, seq: 1 });
  };

  it('keeps what was typed and applies it to the session text as one splice', () => {
    const h = harness();
    const text = createCollabText(h.cells.port, KEY);
    texts.push(text);
    const element = textarea('Fix the login bug');
    text.bind(element);
    type(element, 'Fix the login bug now');
    expect(updatesOf(h.posted)).toEqual([]);
    expect(element.value).toBe('Fix the login bug now');
    session(h, 'Fix the login bug');
    expect(element.value).toBe('Fix the login bug now');
    const [sent] = updatesOf(h.posted);
    expect(Y.decodeUpdate(sent!.update).structs.map((struct) => (struct as Y.Item).content.getContent().join(''))).toEqual([' now']);
    Y.applyUpdate(h.server, sent!.update);
    expect(h.server.getText('region').toString()).toBe('Fix the login bug now');
    expect(text.status).toBe('pending');
  });

  it('merges it beside a change someone else made meanwhile: nothing lost, nothing doubled', () => {
    const h = harness();
    const text = createCollabText(h.cells.port, KEY);
    texts.push(text);
    const element = textarea('Fix the login bug');
    text.bind(element);
    type(element, 'Fix the login bug now');
    // Someone else's unsaved typing is already in the session's text.
    session(h, 'Urgent: Fix the login bug');
    expect(element.value).toBe('Urgent: Fix the login bug now');
    for (const message of updatesOf(h.posted)) Y.applyUpdate(h.server, message.update);
    expect(h.server.getText('region').toString()).toBe('Urgent: Fix the login bug now');
  });

  it('when the reader may not write: the saved value comes back, read-only, and the typing is reported', () => {
    const h = harness();
    const text = createCollabText(h.cells.port, KEY);
    texts.push(text);
    const element = textarea('Fix the login bug');
    text.bind(element);
    const errors: CollabError[] = [];
    text.on('error', (error) => errors.push(error));
    type(element, 'Fix the login bug, mine');
    h.say({ kind: 'region-closed', regionId: KEY, reason: 'readonly' });
    expect(text.status).toBe('readonly');
    expect(element.readOnly).toBe(true);
    expect(element.value).toBe('Fix the login bug');
    expect(errors).toEqual([{ reason: 'readonly', message: 'You can only read this here.', unsaved: 'Fix the login bug, mine' }]);
    expect(text.error).toEqual(errors[0]);
    // Nothing typed reaches the cell afterwards.
    type(element, 'more');
    expect(updatesOf(h.posted)).toEqual([]);
  });

  it('merges by splice position, keeping both sides of overlapping changes', () => {
    expect(mergeEarlyTyping('abc', 'abc', 'xabc')).toBe('xabc');
    expect(mergeEarlyTyping('abc', 'abcd', 'abc')).toBe('abcd');
    expect(mergeEarlyTyping('hello world', 'hello brave world', 'hello world!')).toBe('hello brave world!');
    expect(mergeEarlyTyping('hello world', 'hello brave world', 'Oh hello world')).toBe('Oh hello brave world');
    // Both rewrote the same word: theirs stays, mine is inserted beside it (nothing removed of theirs).
    expect(mergeEarlyTyping('one two three', 'one 2 three', 'one TWO three')).toBe('one 2TWO three');
  });
});

describe('when editing ends', () => {
  it('a refused text stays visible, read-only, and the error carries it', () => {
    const { text, say } = open('Fix the login bug');
    const element = textarea();
    text.bind(element);
    const errors: CollabError[] = [];
    text.on('error', (error) => errors.push(error));
    type(element, 'Fix the login bug!!');
    say({ kind: 'region-closed', regionId: KEY, reason: 'check_violation' });
    expect(text.status).toBe('readonly');
    expect(element.readOnly).toBe(true);
    expect(element.value).toBe('Fix the login bug!!');
    expect(errors).toEqual([{ reason: 'check_violation', message: 'The dataset does not accept this text, so it was not saved.', unsaved: 'Fix the login bug!!' }]);
  });

  it('a save the dataset rejected reports the text even after every update was stored', () => {
    const { text, say } = open('draft');
    const element = textarea();
    text.bind(element);
    type(element, 'draft two');
    say({ kind: 'region-ack', regionId: KEY, seq: 2, settled: 1 });
    expect(text.status).toBe('synced');
    say({ kind: 'region-closed', regionId: KEY, reason: 'rejected' });
    expect(text.error).toMatchObject({ reason: 'rejected', unsaved: 'draft two' });
    expect(element.value).toBe('draft two');
  });

  it('a deleted row is read-only with its reason, and nothing unsaved when everything was stored', () => {
    const { text, say } = open('kept');
    const element = textarea();
    text.bind(element);
    say({ kind: 'region-closed', regionId: KEY, reason: 'removed' });
    expect(text.error).toEqual({ reason: 'removed', message: 'This row was deleted.' });
  });
});

describe('who may write', () => {
  it('a refusal is readonly: elements become read-only and keep their value; destroy restores them', () => {
    const h = harness();
    const text = createCollabText(h.cells.port, KEY);
    texts.push(text);
    const element = textarea('Stored value');
    text.bind(element);
    h.say({ kind: 'region-closed', regionId: KEY, reason: 'readonly' });
    expect(text.status).toBe('readonly');
    expect(element.readOnly).toBe(true);
    expect(element.value).toBe('Stored value');
    text.destroy();
    expect(element.readOnly).toBe(false);
  });

  it('a page outside the app answers readonly with no message to any parent', async () => {
    const h = harness({ writable: false });
    const text = createCollabText(h.cells.port, KEY);
    texts.push(text);
    await Promise.resolve();
    expect(text.status).toBe('readonly');
    expect(text.error).toBeNull();
    expect(h.posted).toEqual([]);
  });

  it('losing the page connection is offline; a new connection opens the cell again and retypes what was not stored', () => {
    const { text, posted, frame, cells, server } = open('draft');
    const element = textarea();
    text.bind(element);
    type(element, 'draft 2');
    frame.dispose();
    expect(text.status).toBe('offline');
    const again: RegionFrameMessage[] = [];
    const next = cells.attach((message) => again.push(message));
    expect(again).toEqual([{ kind: 'region-open', regionId: KEY }]);
    // The new session's state lacks the unsent edit: it is typed again under the new client id.
    next.receive({ kind: 'region-session', regionId: KEY, regionKind: 'text', clientId: 5151, state: Y.encodeStateAsUpdate(server), seq: 1 } as never);
    const [resent] = updatesOf(again);
    expect(Y.decodeUpdate(resent!.update).structs.every((struct) => struct.id.client === 5151)).toBe(true);
    Y.applyUpdate(server, resent!.update);
    expect(server.getText('region').toString()).toBe('draft 2');
    expect(text.status).toBe('pending');
    expect(updatesOf(posted)).toHaveLength(1);
  });

  it('refuses a key that is not a cell and a cell bound twice', () => {
    const h = harness();
    expect(() => createCollabText(h.cells.port, 'af-6')).toThrow();
    texts.push(createCollabText(h.cells.port, KEY));
    expect(() => createCollabText(h.cells.port, KEY)).toThrow();
  });
});
