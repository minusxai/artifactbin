/**
 * The page's region editing (solid/document/region-editing): which regions an editor's frame may edit, the relay
 * between the frame's editor and the region client, what the frame is told (bytes and ids, never a credential),
 * leaving the page, and save-before-comment ordering against one fake server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { RegionFrameMessage, RegionParentMessage } from '@artifactbin/contracts';
import { createRegionClient, encodeBase64, type RegionClient, type RegionClientEvents, type RegionSession } from '@/lib/artifact-backend/region-http';
import { commentAfterRegionSave } from '@/lib/annotations/region-comment';
import { openRegionDoc } from '@/lib/live-regions/cells';
import { regionMembership, startRegionEditing } from '../region-editing';

const PAGE = `<!doctype html><html data-af-id="h"><head data-af-id="hd"></head><body data-af-id="b">
<h1 data-af-id="title" data-af-editable="text">Title</h1>
<p data-af-id="intro">Fixed</p>
<article data-af-id="notes" data-af-editable="rich"><p data-af-id="n1">One <strong>bold</strong></p><ul data-af-id="l"><li data-af-id="li">x</li></ul></article>
<div data-af-id="odd" data-af-editable="other"><p data-af-id="o1">no</p></div>
</body></html>`;

function fakeBridge() {
  const sent: RegionParentMessage[] = [];
  const listeners = new Set<(message: RegionFrameMessage) => void>();
  let enabled = false;
  return {
    sent,
    bridge: {
      sendRegion: (message: RegionParentMessage) => { if (message.kind === 'regions-enabled') enabled = message.regionIds.length > 0; sent.push(message); },
      subscribeRegion: (listener: (message: RegionFrameMessage) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      regionsEnabled: () => enabled,
    },
    say: (message: RegionFrameMessage) => { for (const listener of [...listeners]) listener(message); },
    listening: () => listeners.size,
  };
}

function fakeClient() {
  let events!: RegionClientEvents;
  const calls: string[] = [];
  const pushed: Array<[string, Uint8Array]> = [];
  let refuse = false;
  const session: RegionSession = { regionId: 'notes', kind: 'rich', clientId: 7, seq: 3, state: new Uint8Array([1, 2, 3]), savedVersion: 5 };
  const client: RegionClient = {
    open: vi.fn(async (regionId: string) => { calls.push(`open ${regionId}`); return refuse ? null : { ...session, regionId, ...{ token: 'leak' } } as RegionSession; }),
    push: (regionId, update) => { pushed.push([regionId, update]); },
    close: (regionId) => { calls.push(`close ${regionId}`); },
    flush: vi.fn(async () => { calls.push('flush'); return 6; }),
    leave: () => { calls.push('leave'); },
    resume: () => { calls.push('resume'); },
    dispose: () => { calls.push('dispose'); },
  };
  return { client, calls, pushed, events: () => events, refuse: () => { refuse = true; }, make: (next: RegionClientEvents) => { events = next; return client; } };
}

const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); });

describe('regionMembership', () => {
  it('lists the rich and text regions and every identity inside them, and every identity the page holds', () => {
    const membership = regionMembership(PAGE);
    expect(membership.regions).toEqual([{ id: 'title', kind: 'text' }, { id: 'notes', kind: 'rich' }]);
    expect([...membership.inside].sort()).toEqual(['l', 'li', 'n1', 'notes', 'title']);
    expect(membership.known.has('intro')).toBe(true);
    expect(membership.known.has('o1')).toBe(true);
    expect(membership.inside.has('o1')).toBe(false);
    expect(regionMembership('<p data-af-id="a">no regions</p>').regions).toEqual([]);
  });
});

describe('startRegionEditing', () => {
  it('tells the frame which regions it may edit, only once the saved page names some', async () => {
    const frame = fakeBridge(), server = fakeClient();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget() });
    editing.attached();
    await settle();
    expect(frame.sent).toEqual([{ kind: 'regions-enabled', regionIds: ['title', 'notes'] }]);
    const none = fakeBridge();
    startRegionEditing({ id: 'doc1', bridge: none.bridge, loadHtml: async () => '<p data-af-id="a">x</p>', createClient: fakeClient().make, win: new EventTarget() }).attached();
    await settle();
    expect(none.sent).toEqual([]);
    expect(none.listening()).toBe(0);
  });

  it('opens a region the frame asks for and sends only the session\'s bytes and ids', async () => {
    const frame = fakeBridge(), server = fakeClient();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget() });
    editing.attached();
    await settle();
    frame.say({ kind: 'region-open', regionId: 'odd' });
    frame.say({ kind: 'region-open', regionId: 'notes' });
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await settle();
    expect(server.calls).toEqual(['open notes']);
    expect(frame.sent.at(-1)).toEqual({ kind: 'region-session', regionId: 'notes', regionKind: 'rich', clientId: 7, state: new Uint8Array([1, 2, 3]), seq: 3 });
    // Updates go out; remote updates, acks and closes come back.
    frame.say({ kind: 'region-update', regionId: 'notes', update: new Uint8Array([9]) });
    frame.say({ kind: 'region-update', regionId: 'title', update: new Uint8Array([8]) });
    expect(server.pushed).toEqual([['notes', new Uint8Array([9])]]);
    server.events().remote('notes', [new Uint8Array([4])], 4);
    server.events().ack('notes', 5);
    server.events().closed('notes', 'access');
    expect(frame.sent.slice(-3)).toEqual([
      { kind: 'region-remote', regionId: 'notes', updates: [new Uint8Array([4])], seq: 4 },
      { kind: 'region-ack', regionId: 'notes', seq: 5 },
      { kind: 'region-closed', regionId: 'notes', reason: 'access' },
    ]);
    frame.say({ kind: 'region-update', regionId: 'notes', update: new Uint8Array([10]) });
    expect(server.pushed).toHaveLength(1);
    // Nothing the frame is told names a credential, a cookie or a token.
    const told = JSON.stringify(frame.sent, (_key, value: unknown) => value instanceof Uint8Array ? [...value] : value);
    expect(told).not.toMatch(/token|leak|cookie|bearer|authorization|secret|savedVersion/i);
  });

  it('a doc (autoOpen) opens its first rich region with no press, takes the focus once, and opens it again for a new document', async () => {
    const frame = fakeBridge(), server = fakeClient();
    const focusFrame = vi.fn();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget(), autoOpen: true, focusFrame });
    editing.attached();
    await settle();
    expect(server.calls).toEqual(['open notes']);
    expect(frame.sent).toEqual([
      { kind: 'regions-enabled', regionIds: ['title', 'notes'] },
      // The focus first, so keys typed while the session opens are held by the frame.
      { kind: 'region-command', regionId: 'notes', name: 'focus' },
      { kind: 'region-session', regionId: 'notes', regionKind: 'rich', clientId: 7, state: new Uint8Array([1, 2, 3]), seq: 3 },
    ]);
    expect(focusFrame).toHaveBeenCalledOnce();
    // The frame asking for the same region (a press) opens nothing more.
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await settle();
    expect(server.calls).toEqual(['open notes']);
    // A new document in the frame: the session ends and the region opens again, without taking the focus a second time.
    editing.attached();
    await settle();
    expect(server.calls).toEqual(['open notes', 'close notes', 'open notes']);
    expect(frame.sent.slice(3)).toEqual([
      { kind: 'regions-enabled', regionIds: ['title', 'notes'] },
      { kind: 'region-session', regionId: 'notes', regionKind: 'rich', clientId: 7, state: new Uint8Array([1, 2, 3]), seq: 3 },
    ]);
    expect(focusFrame).toHaveBeenCalledOnce();
  });

  it('a page that is not a doc opens nothing until the frame asks, and a doc whose open is refused is closed in the frame', async () => {
    const plain = fakeBridge(), server = fakeClient();
    startRegionEditing({ id: 'doc1', bridge: plain.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget() }).attached();
    await settle();
    expect(server.calls).toEqual([]);
    expect(plain.sent).toEqual([{ kind: 'regions-enabled', regionIds: ['title', 'notes'] }]);
    const refused = fakeBridge(), closed = fakeClient(), focusFrame = vi.fn();
    closed.refuse();
    startRegionEditing({ id: 'doc1', bridge: refused.bridge, loadHtml: async () => PAGE, createClient: closed.make, win: new EventTarget(), autoOpen: true, focusFrame }).attached();
    await settle();
    // The focus moves as the open starts (so keys typed meanwhile are held); a refusal then closes the region, which
    // drops what the frame held for it.
    expect(refused.sent.map((message) => message.kind)).toEqual(['regions-enabled', 'region-command', 'region-closed']);
    expect(refused.sent.at(-1)).toEqual({ kind: 'region-closed', regionId: 'notes', reason: 'refused' });
    expect(focusFrame).toHaveBeenCalledOnce();
  });

  it('a refused open closes the region in the frame', async () => {
    const frame = fakeBridge(), server = fakeClient();
    server.refuse();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget() });
    editing.attached();
    await settle();
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await settle();
    expect(frame.sent.at(-1)).toEqual({ kind: 'region-closed', regionId: 'notes', reason: 'refused' });
  });

  it('a new document in the frame ends the old sessions and is told its regions again', async () => {
    const frame = fakeBridge(), server = fakeClient();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget() });
    editing.attached();
    await settle();
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await settle();
    editing.attached();
    await settle();
    expect(server.calls).toEqual(['open notes', 'close notes']);
    expect(frame.sent.at(-1)).toEqual({ kind: 'regions-enabled', regionIds: ['title', 'notes'] });
  });

  it('leaving the page leaves the client (its stream closes, pending edits go with keepalive), and coming back resumes', async () => {
    const frame = fakeBridge(), server = fakeClient(), win = new EventTarget();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win });
    editing.attached();
    await settle();
    win.dispatchEvent(new Event('pagehide'));
    win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    editing.dispose();
    win.dispatchEvent(new Event('pagehide'));
    expect(server.calls).toEqual(['leave', 'resume', 'dispose']);
    expect(frame.listening()).toBe(0);
  });

  it('saves before a comment inside a region: pending edits, then the save, then the comment, anchored to the saved version', async () => {
    const order: string[] = [];
    const doc = openRegionDoc(undefined, { gc: true });
    let seq = 0;
    const fetch = async (path: string, init: RequestInit): Promise<Response> => {
      order.push(path.split('/').slice(-1)[0]!);
      if (path.endsWith('/open')) return Response.json({ regionId: 'notes', kind: 'rich', clientId: 7, seq, state: encodeBase64(Y.encodeStateAsUpdate(doc)), savedVersion: 5 });
      if (path.endsWith('/updates')) { Y.applyUpdate(doc, Uint8Array.from(atob((JSON.parse(String(init.body)) as { update: string }).update), (c) => c.charCodeAt(0))); return Response.json({ seq: ++seq }); }
      if (path.endsWith('/flush')) return Response.json({ version: 6 });
      return new Response(null, { status: 404 });
    };
    const frame = fakeBridge();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: (events) => createRegionClient('doc1', events, { fetch, openStream: () => ({ close() {} }) }), win: new EventTarget() });
    editing.attached();
    await settle();
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await vi.waitFor(() => expect(frame.sent.at(-1)?.kind).toBe('region-session'));
    const local = openRegionDoc(undefined, { gc: true });
    local.clientID = 7;
    const before = Y.encodeStateVector(local);
    local.getText('region').insert(0, 'unsaved words');
    frame.say({ kind: 'region-update', regionId: 'notes', update: Y.encodeStateAsUpdate(local, before) });
    const subject = await commentAfterRegionSave({ anchor: { kind: 'html-node', v: 1, revision: '5', nodeId: 'n1', quote: 'unsaved words' } }, { membership: editing.membership, save: editing.save });
    order.push('annotations');
    expect(order).toEqual(['open', 'updates', 'flush', 'annotations']);
    expect(subject.anchor.revision).toBe('6');
    expect(doc.getText('region').toString()).toBe('unsaved words');
    editing.dispose();
  });
});

describe('the editing chrome\'s state and commands', () => {
  const caret = (regionId: string, marks: string[], block: string): RegionFrameMessage => ({ kind: 'region-caret', regionId, anchor: 'AA==', head: 'AA==', marks, block });

  it('follows this person\'s editor from its first caret (a blur keeps it) until its session ends, and sends commands to it', async () => {
    const frame = fakeBridge(), server = fakeClient();
    const toolbar: unknown[] = [], slash: unknown[] = [], links: unknown[] = [];
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget(),
      onToolbar: (state) => toolbar.push(state), onSlash: (at) => slash.push(at), onLink: (request) => links.push(request) });
    editing.attached();
    await settle();
    // Nothing for a region without a session (a forged caret, slash or link from the frame).
    frame.say(caret('notes', ['strong'], 'h2'));
    frame.say({ kind: 'region-slash', regionId: 'notes', x: 1, y: 2 });
    frame.say({ kind: 'region-link', regionId: 'notes', href: null });
    expect(editing.command('strong')).toBe(false);
    expect([toolbar, slash, links]).toEqual([[], [], []]);
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await settle();
    frame.say(caret('notes', ['strong'], 'h2'));
    frame.say({ kind: 'region-blur' });
    frame.say(caret('notes', [], 'bullet'));
    expect(toolbar).toEqual([{ regionId: 'notes', kind: 'rich', marks: ['strong'], block: 'h2' }, { regionId: 'notes', kind: 'rich', marks: [], block: 'bullet' }]);
    frame.say({ kind: 'region-slash', regionId: 'notes', x: 10, y: 20 });
    frame.say({ kind: 'region-link', regionId: 'notes', href: 'https://a.example/' });
    expect(slash).toEqual([{ regionId: 'notes', x: 10, y: 20 }]);
    expect(links).toEqual([{ regionId: 'notes', href: 'https://a.example/' }]);
    expect(editing.command('list', { type: null })).toBe(true);
    expect(editing.command('undo')).toBe(true);
    expect(frame.sent.slice(-2)).toEqual([
      { kind: 'region-command', regionId: 'notes', name: 'list', args: { type: null } },
      { kind: 'region-command', regionId: 'notes', name: 'undo' },
    ]);
    // The session ends: the chrome goes, and commands have nowhere to go.
    server.events().closed('notes', 'access');
    expect(toolbar.at(-1)).toBeNull();
    expect(slash.at(-1)).toBeNull();
    expect(editing.command('strong')).toBe(false);
    // A new document ends it too.
    frame.say({ kind: 'region-open', regionId: 'notes' });
    await settle();
    frame.say(caret('notes', [], 'paragraph'));
    expect(toolbar.at(-1)).toEqual({ regionId: 'notes', kind: 'rich', marks: [], block: 'paragraph' });
    editing.attached();
    expect(toolbar.at(-1)).toBeNull();
    editing.dispose();
  });

  it('a doc opened to show a comment (autoFocus false) still opens its region, but asks for no focus', async () => {
    const frame = fakeBridge(), server = fakeClient(), focusFrame = vi.fn();
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => PAGE, createClient: server.make, win: new EventTarget(), autoOpen: true, autoFocus: false, focusFrame });
    editing.attached();
    await settle();
    expect(server.calls).toEqual(['open notes']);
    expect(frame.sent.map((message) => message.kind)).toEqual(['regions-enabled', 'region-session']);
    expect(focusFrame).not.toHaveBeenCalled();
  });
});

describe('membership after saves', () => {
  it('reads the saved page again after a save, and no comment waits for a save before regions are known', async () => {
    const frame = fakeBridge(), server = fakeClient();
    const pages = [PAGE, PAGE.replace('<li data-af-id="li">x</li>', '<li data-af-id="li">x</li><li data-af-id="new">y</li>')];
    const loadHtml = vi.fn(async () => pages.shift() ?? null);
    const saved: number[] = [];
    let resolveFirst!: () => void;
    const gate = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const editing = startRegionEditing({ id: 'doc1', bridge: frame.bridge, loadHtml: async () => { await gate; return loadHtml(); }, createClient: server.make, win: new EventTarget(), onSaved: (version) => saved.push(version) });
    expect(editing.membership().inside.size).toBe(0);
    expect(editing.membership().known.has('anything')).toBe(true);
    resolveFirst();
    await settle();
    expect(editing.membership().known.has('new')).toBe(false);
    server.events().saved(6, { notes: 4 });
    await settle();
    expect(saved).toEqual([6]);
    expect(editing.membership().inside.has('new')).toBe(true);
  });
});
