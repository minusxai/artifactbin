/**
 * A LIVE DATASET TEXT CELL in the page (`@afbin/collab`, contracts region-sessions CellScope): one Y.Text per cell
 * (lib/live-regions/cells), synced through the frame's cell port (./frame-cells), bound two-way to plain inputs and
 * textareas. No ProseMirror: an input's new value is applied as its smallest splice, and a remote edit is drawn
 * with the caret kept where it was (Yjs relative positions).
 *
 *  - IME: while an element composes, neither its value is read nor remote edits drawn into it; they wait, and at
 *    `compositionend` the composed text is applied first and the waiting edits after it.
 *  - Updates may arrive twice or out of order: Yjs ignores what it holds and keeps what it cannot place yet.
 *  - `status`: `synced` (everything typed here is stored), `pending` (some is not yet), `offline` (no connection to the
 *    page, the edits wait), `readonly` (this reader may not change the cell, or it closed: inputs are read-only).
 */
import * as Y from 'yjs';
import type { CollabStatus } from '@artifactbin/contracts';
import { cellText, spliceText } from '../live-regions/cells';
import type { CellLink, CellPeer, CellPort } from './frame-cells';

type Field = HTMLInputElement | HTMLTextAreaElement;
export interface CollabBinding { destroy(): void }
export interface CollabText {
  readonly key: string;
  readonly value: string;
  readonly status: CollabStatus;
  /** Two-way: the element shows the cell and every edit in it is the cell's. */
  bind(element: Field): CollabBinding;
  on(event: 'change', listener: (value: string) => void): () => void;
  on(event: 'status', listener: (status: CollabStatus) => void): () => void;
  destroy(): void;
}

/** The origin of what came from the page (remote updates, a session's state): never sent back. */
const REMOTE = Symbol('collab-remote');

export function createCollabText(port: CellPort, key: string, onDestroy: () => void = () => {}): CollabText {
  let doc: Y.Doc | null = null;
  let status: CollabStatus = 'offline';
  let value = '';
  /** This session's updates sent, and how many of them the page has said are stored. */
  let posted = 0, stored = 0;
  /** Remote updates waiting for a composition to end. */
  let waiting: Uint8Array[] = [];
  let destroyed = false;
  const fields = new Map<Field, { composing: boolean; readOnly: boolean; stop: () => void }>();
  const changeListeners = new Set<(value: string) => void>();
  const statusListeners = new Set<(status: CollabStatus) => void>();

  const setStatus = (next: CollabStatus) => {
    if (next === status) return;
    status = next;
    for (const field of fields.keys()) field.readOnly = next === 'readonly' || (fields.get(field)!.readOnly);
    for (const listener of [...statusListeners]) listener(next);
  };
  const changed = () => {
    const next = doc ? cellText(doc).toString() : value;
    if (next === value) return;
    value = next;
    for (const listener of [...changeListeners]) listener(next);
  };
  const composing = () => [...fields.values()].some((field) => field.composing);

  /** Draws the cell into every element whose value differs, keeping a focused element's selection on its text. */
  const draw = (keep: Map<Field, [Y.RelativePosition, Y.RelativePosition, Field['selectionDirection']]> = new Map()) => {
    if (!doc) return;
    const text = cellText(doc), shown = text.toString();
    for (const field of fields.keys()) {
      if (field.value === shown) continue;
      const kept = keep.get(field);
      field.value = shown;
      if (!kept) continue;
      const at = (position: Y.RelativePosition) => Y.createAbsolutePositionFromRelativePosition(position, doc!)?.index ?? shown.length;
      const start = at(kept[0]), end = at(kept[1]);
      field.setSelectionRange(start, end, kept[2] ?? undefined);
    }
  };
  /** Remote updates applied with each focused element's caret captured before and drawn after. */
  const applyRemote = (updates: Uint8Array[]) => {
    if (!doc || !updates.length) return;
    const text = cellText(doc);
    const keep = new Map<Field, [Y.RelativePosition, Y.RelativePosition, Field['selectionDirection']]>();
    for (const field of fields.keys()) {
      if (field.ownerDocument.activeElement !== field || field.value !== text.toString()) continue;
      // Associated to the left: text another person inserts exactly at the caret goes after it.
      keep.set(field, [Y.createRelativePositionFromTypeIndex(text, field.selectionStart ?? 0, -1), Y.createRelativePositionFromTypeIndex(text, field.selectionEnd ?? 0, -1), field.selectionDirection]);
    }
    doc.transact(() => { for (const update of updates) Y.applyUpdate(doc!, update, REMOTE); }, REMOTE);
    draw(keep);
    changed();
  };

  const readField = (field: Field) => {
    if (!doc || status === 'readonly') return;
    spliceText(cellText(doc), field.value);
    draw();
    changed();
  };

  const startDoc = (clientId: number, state: Uint8Array) => {
    const typed = doc ? cellText(doc).toString() : null;
    const unsaved = doc !== null && stored < posted;
    doc?.destroy();
    const next = new Y.Doc();
    next.clientID = clientId;
    Y.applyUpdate(next, state, REMOTE);
    next.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || next !== doc) return;
      posted++;
      setStatus('pending');
      link.update(update);
    });
    doc = next;
    posted = 0; stored = 0;
    // What this frame typed that the previous session may not have stored is typed again into the new one.
    if (unsaved && typed !== null) spliceText(cellText(next), typed);
    if (status !== 'pending') setStatus('synced');
    draw();
    changed();
  };

  const peer: CellPeer = {
    session(clientId, state) { if (!destroyed) startDoc(clientId, state); },
    remote(updates) {
      if (destroyed || !doc) return;
      if (composing()) waiting.push(...updates);
      else applyRemote(updates);
    },
    ack(settled) {
      if (settled === null) return;
      stored = Math.max(stored, settled);
      if (stored >= posted && status === 'pending') setStatus('synced');
    },
    closed() {
      doc?.destroy();
      doc = null;
      waiting = [];
      setStatus('readonly');
    },
    connected(on) {
      if (!on && status !== 'readonly') setStatus('offline');
    },
  };
  const link: CellLink = port.connect(key, peer);

  const text: CollabText = {
    key,
    get value() { return value; },
    get status() { return status; },
    bind(field) {
      if (fields.has(field)) throw new Error('@afbin/collab: this element is already bound');
      const state = { composing: false, readOnly: field.readOnly, stop: () => {} };
      const onInput = (event: Event) => { if (!state.composing && !(event as InputEvent).isComposing) readField(field); };
      const onStart = () => { state.composing = true; };
      const onEnd = () => {
        state.composing = false;
        readField(field);
        if (!composing() && waiting.length) { const updates = waiting; waiting = []; applyRemote(updates); }
      };
      field.addEventListener('input', onInput);
      field.addEventListener('compositionstart', onStart);
      field.addEventListener('compositionend', onEnd);
      state.stop = () => {
        field.removeEventListener('input', onInput);
        field.removeEventListener('compositionstart', onStart);
        field.removeEventListener('compositionend', onEnd);
        field.readOnly = state.readOnly;
      };
      fields.set(field, state);
      if (status === 'readonly') field.readOnly = true;
      draw();
      return { destroy() { if (fields.get(field) === state) { fields.delete(field); state.stop(); } } };
    },
    on(event: 'change' | 'status', listener: ((value: string) => void) | ((status: CollabStatus) => void)) {
      const set = (event === 'change' ? changeListeners : statusListeners) as Set<typeof listener>;
      set.add(listener);
      return () => { set.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const state of fields.values()) state.stop();
      fields.clear();
      link.close();
      doc?.destroy();
      doc = null;
      onDestroy();
    },
  } as CollabText;
  return text;
}
