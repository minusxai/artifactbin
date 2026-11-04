/**
 * A room of real editors (jsdom EditorViews bound through the module's own editor state) around a server that
 * holds the live state, the saved page and its snapshot, with explicit delivery: nothing reaches anyone until a test
 * moves it. Delivery is a star through the server, as the product's will be. Every client starts from the server's
 * state bytes. `invariants()` checks I1–I3, I5 and I6 on a settled room; I4 is each test's (typed text it names).
 */
import { afterAll, beforeAll, expect } from 'vitest';
import { TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import * as Y from 'yjs';
import { installEditorGeometry } from '../../../test/setup/editor-geometry';
import { canonicalizeHtmlPage, type HtmlIdentityLedger } from '../../html-page';
import { attribute, parseSource } from '../../html-page/html-source';
import { applyRegionRevision, compactRegion, createRegionState, editorState, normalizeRegionHtml, regionCommands, regionHtml, regionText, type RegionKind } from '..';
import { stopCapturing } from '../binding';
import { writeRegion } from '../html';
import { ID_ATTRS } from '../schema';
import { liveDocument, readDocument } from '../state';

// jsdom has no layout; every file that opens a room gets the editor geometry stubs.
let restoreGeometry: () => void;
beforeAll(() => { restoreGeometry = installEditorGeometry(); });
afterAll(() => restoreGeometry());

const REMOTE = 'remote';
const PAGE = (region: string, kind: RegionKind) => {
  const tag = kind === 'rich' ? 'article' : 'h1';
  return `<!doctype html><html><head><title>Plan</title><style>p{color:red}</style></head><body>
<header><h1>Fixed title</h1></header>
<${tag} data-af-editable="${kind}">${region}</${tag}>
<script type="module">document.title='x';</script>
</body></html>`;
};
/** HTML without its ids, for comparisons that are about content. */
export const bare = (html: string) => html.replace(/ data-af-id="[^"]*"/g, '');
export const idsOf = (html: string) => [...html.matchAll(/data-af-id="([^"]+)"/g)].map((match) => match[1]!);

function regionOf(html: string, regionId?: string) {
  const element = parseSource(html).elements.find((candidate) => (regionId ? attribute(candidate, 'data-af-id') === regionId : attribute(candidate, 'data-af-editable') !== null))!;
  const location = element.sourceCodeLocation!;
  const start = location.startTag!.endOffset, end = location.endTag!.startOffset;
  return { id: attribute(element, 'data-af-id')!, inner: html.slice(start, end), before: html.slice(0, start), after: html.slice(end) };
}

export class Client {
  readonly doc: Y.Doc;
  readonly view: EditorView;
  readonly outbox: Uint8Array[] = [];
  readonly received = new Set<number>();
  online = true;
  constructor(readonly room: Room, readonly name: string, clientID: number) {
    this.doc = new Y.Doc();
    this.doc.clientID = clientID;
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(room.server), REMOTE);
    room.log.forEach((_update, index) => this.received.add(index));
    this.doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== REMOTE) this.outbox.push(update); });
    const mount = document.createElement('div');
    document.body.append(mount);
    this.view = new EditorView(mount, { state: editorState(room.kind, regionText(this.doc)) });
  }
  get state() { return this.view.state; }
  /** The region as this editor shows it, and as its Yjs replica reads. */
  html() { return writeRegion(this.room.kind, this.view.state.doc); }
  replicaHtml() { return regionHtml(this.room.kind, Y.encodeStateAsUpdate(this.doc)); }
  /** Position of the start (or, with `after`, the end) of the `nth` occurrence of `text` in block text. */
  find(text: string, { after = false, nth = 0 } = {}): number {
    let found = -1, seen = 0;
    this.state.doc.forEach((block, offset) => {
      if (found >= 0 || !block.isTextblock) return;
      let from = 0;
      for (;;) {
        const at = block.textContent.indexOf(text, from);
        if (at < 0) return;
        if (seen++ === nth) { found = offset + 1 + at + (after ? text.length : 0); return; }
        from = at + 1;
      }
    });
    if (found < 0) throw new Error(`${this.name}: no "${text}" in ${this.html()}`);
    return found;
  }
  /** Start of the `index`th block's text, or its end with `end`. */
  blockStart(index: number, end = false): number {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += this.state.doc.child(i).nodeSize;
    return end ? pos + this.state.doc.child(index).nodeSize - 1 : pos + 1;
  }
  select(from: number, to = from) { this.view.dispatch(this.state.tr.setSelection(TextSelection.create(this.state.doc, from, to))); return this; }
  /** Types like a keyboard: each character goes through handleTextInput, so input rules fire. */
  type(text: string) {
    for (const character of Array.from(text)) {
      const { from, to } = this.state.selection;
      const handled = this.view.someProp('handleTextInput', (handler) => handler(this.view, from, to, character, () => this.state.tr.insertText(character, from, to)));
      if (!handled) this.view.dispatch(this.state.tr.insertText(character, from, to));
    }
    return this.step();
  }
  /** Presses a key through the editor's keymap. */
  key(key: string, modifiers: { shift?: boolean; mod?: boolean } = {}) {
    const event = new KeyboardEvent('keydown', { key, shiftKey: !!modifiers.shift, ctrlKey: !!modifiers.mod, bubbles: true, cancelable: true });
    const handled = this.view.someProp('handleKeyDown', (handler) => handler(this.view, event));
    if (!handled) throw new Error(`${this.name}: ${key} was not handled`);
    return this.step();
  }
  run(command: Command) { if (!command(this.state, this.view.dispatch, this.view)) throw new Error(`${this.name}: command refused`); return this.step(); }
  delete(from: number, to: number) { this.view.dispatch(this.state.tr.delete(from, to)); return this.step(); }
  // jsdom has no ClipboardEvent; the editor reads only the HTML or text it is handed.
  paste(html: string) { this.view.pasteHTML(html, new Event('paste') as ClipboardEvent); return this.step(); }
  pasteText(text: string) { this.view.pasteText(text, new Event('paste') as ClipboardEvent); return this.step(); }
  get commands() { return regionCommands(this.room.kind); }
  undo() { this.commands.undo(this.state, this.view.dispatch, this.view); return this.step(); }
  redo() { this.commands.redo(this.state, this.view.dispatch, this.view); return this.step(); }
  /** One user action is one undo step. */
  private step() { stopCapturing(this.state); return this; }
  destroy() { this.view.destroy(); this.view.dom.parentElement?.remove(); }
}

export class Room {
  readonly server = new Y.Doc({ gc: false });
  readonly log: Uint8Array[] = [];
  readonly clients: Client[] = [];
  page: { html: string; ledger: HtmlIdentityLedger };
  snapshot: Uint8Array | null;
  readonly regionId: string;

  constructor(readonly kind: RegionKind, region: string) {
    this.page = canonicalizeHtmlPage(PAGE(normalizeRegionHtml(kind, region), kind));
    const saved = regionOf(this.page.html);
    this.regionId = saved.id;
    const initial = createRegionState(kind, saved.inner);
    Y.applyUpdate(this.server, initial.state, REMOTE);
    this.snapshot = initial.snapshot;
    this.server.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== REMOTE) this.log.push(update); });
  }

  static open(kind: RegionKind, region: string, names: string[] = ['A', 'B']): [Room, ...Client[]] {
    const room = new Room(kind, region);
    return [room, ...names.map((name) => room.join(name))];
  }
  join(name: string): Client {
    const client = new Client(this, name, this.clients.length + 1);
    this.clients.push(client);
    return client;
  }
  /** A client's pending updates reach the server (only the first `count`, if given). */
  send(client: Client, count = client.outbox.length) {
    for (const update of client.outbox.splice(0, count)) { Y.applyUpdate(this.server, update, REMOTE); this.log.push(update); }
  }
  /** Server log entries reach a client: all it lacks, or the given indexes (in that order, repeats allowed). */
  receive(client: Client, indexes?: number[]) {
    for (const index of indexes ?? this.log.map((_update, i) => i).filter((i) => !client.received.has(i))) {
      Y.applyUpdate(client.doc, this.log[index]!, REMOTE);
      client.received.add(index);
    }
  }
  /** Everyone online exchanges everything, until nothing moves. */
  sync() {
    for (let round = 0; round < 10; round++) {
      const online = this.clients.filter((client) => client.online);
      if (online.every((client) => !client.outbox.length && client.received.size === this.log.length)) return this;
      for (const client of online) this.send(client);
      for (const client of online) this.receive(client);
    }
    throw new Error('room did not settle');
  }
  get state() { return Y.encodeStateAsUpdate(this.server); }
  html() { return regionHtml(this.kind, this.state); }
  /** The author edits the saved page's region and republishes: three-way from the saved version's snapshot. */
  republish(edit: (region: string) => string) {
    const saved = regionOf(this.page.html, this.regionId);
    const page = canonicalizeHtmlPage(saved.before + edit(saved.inner) + saved.after, { previousHtml: this.page.html, ledger: this.page.ledger });
    const revision = applyRegionRevision({ kind: this.kind, live: this.state, savedSnapshot: this.snapshot, html: regionOf(page.html, this.regionId).inner });
    Y.applyUpdate(this.server, revision.update);
    this.page = page;
    this.snapshot = revision.snapshot;
    return this;
  }
  /** An agent's Markdown for the whole region, applied three-way from the saved version (not saved by itself). */
  agent(markdown: string) {
    const revision = applyRegionRevision({ kind: this.kind, live: this.state, savedSnapshot: this.snapshot, markdown });
    Y.applyUpdate(this.server, revision.update);
    return this;
  }
  /** Compaction: the live state becomes the saved page (I5 checked). */
  compact() {
    const before = regionOf(this.page.html, this.regionId);
    const result = compactRegion({ savedHtml: this.page.html, ledger: this.page.ledger, regionId: this.regionId, state: this.state });
    expect(() => canonicalizeHtmlPage(result.html, { previousHtml: this.page.html, ledger: this.page.ledger })).not.toThrow();
    const after = regionOf(result.html, this.regionId);
    expect([after.before, after.after]).toEqual([before.before, before.after]);
    Y.applyUpdate(this.server, result.update);
    this.page = { html: result.html, ledger: result.ledger };
    this.snapshot = result.snapshot;
    return result;
  }
  /** I1–I3, I5, I6 on a settled room; returns the region HTML every replica agrees on. */
  invariants(): string {
    this.sync();
    const html = this.html();
    for (const client of this.clients) {
      expect(client.html(), `I1 ${client.name}'s editor`).toBe(html);
      expect(client.replicaHtml(), `I1 ${client.name}'s replica`).toBe(html);
      expect(() => client.state.doc.check(), `I2 ${client.name}`).not.toThrow();
      const blockIds: string[] = [];
      client.state.doc.forEach((block) => { for (const name of ID_ATTRS) if (typeof block.attrs[name] === 'string') blockIds.push(block.attrs[name]); });
      expect(new Set(blockIds).size, `I3 ${client.name}'s ids ${blockIds}`).toBe(blockIds.length);
    }
    expect(() => readDocument(this.kind, liveDocument(this.state)).check(), 'I2 server').not.toThrow();
    expect(new Set(idsOf(html)).size, `I3 ${html}`).toBe(idsOf(html).length);
    // I5 on a copy: compaction must succeed and touch nothing outside the region.
    const page = compactRegion({ savedHtml: this.page.html, ledger: this.page.ledger, regionId: this.regionId, state: this.state });
    expect(() => canonicalizeHtmlPage(page.html, { previousHtml: this.page.html, ledger: this.page.ledger }), 'I5 accepted').not.toThrow();
    const saved = regionOf(this.page.html, this.regionId), compacted = regionOf(page.html, this.regionId);
    expect([compacted.before, compacted.after], 'I5').toEqual([saved.before, saved.after]);
    expect(normalizeRegionHtml(this.kind, html), 'I6 normal form').toBe(html);
    expect(regionHtml(this.kind, createRegionState(this.kind, html).state), 'I6 through Yjs').toBe(html);
    return html;
  }
  destroy() { for (const client of this.clients) client.destroy(); }
}
