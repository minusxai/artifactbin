/**
 * THE ProseMirror ↔ Y.Text BINDING (the one module that writes a region's shared text from an editor).
 *
 * Local edits go out STEP BY STEP, not as a document diff. Each step's map names exactly the ranges it replaced, so
 * each becomes the smallest Y.Text edit: an insertion where the user typed, a deletion where they deleted, a format
 * where a mark or a block attribute changed. A whole-document diff would have to guess where two separate changes in
 * one transaction were (an input rule removes two delimiters), and a guess that spans other people's text deletes
 * and re-inserts it. Where line ends make a place ambiguous (Enter at a block's end inserts a "\n" next to a "\n")
 * the edit slides right, so the original "\n", which carries the block's ids and attributes, stays with the text
 * it ended.
 *
 * Remote changes (and undo) come in as Y.Text events: the document is re-read from the shared text, only the blocks
 * that changed are replaced, and the selection is carried by Yjs relative positions captured before the change.
 * Local changes are written with this editor's own origin, which is the only origin its Y.UndoManager tracks, so a
 * person undoes only their own edits; a transaction marked `addToHistory: false` (the id dedupe) is written with a
 * second, untracked origin. The editor never writes back what it receives.
 *
 * Prior art: y-quill binds Quill's delta to the same Y.Text shape; y-prosemirror binds ProseMirror to an XML tree.
 */
import { Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import * as Y from 'yjs';
import { documentUnits, insertUnits, keysOf, Linear, readText, type Attrs, type Unit } from './lines';
import type { RegionKind } from './schema';

interface BindingState { binding: Binding; pending: readonly Transaction[] }
const bindingKey = new PluginKey<BindingState>('live-region-binding');

/** One step's effect on the shared text, from the documents before and after it. */
function writeStep(text: Y.Text, kind: RegionKind, step: { getMap(): { forEach(f: (a: number, b: number, c: number, d: number) => void): void } }, before: PMNode, after: PMNode): void {
  const ranges: [number, number, number, number][] = [];
  step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => { ranges.push([oldStart, oldEnd, newStart, newEnd]); });
  if (!ranges.length) {
    // Mark and attribute steps change no positions; they name what they touched.
    const touched = step as unknown as { from?: number; to?: number; pos?: number };
    if (typeof touched.from === 'number' && typeof touched.to === 'number') ranges.push([touched.from, touched.to, touched.from, touched.to]);
    else if (typeof touched.pos === 'number') { const size = before.nodeAt(touched.pos)?.nodeSize ?? 0; ranges.push([touched.pos, touched.pos + size, touched.pos, touched.pos + size]); }
    else ranges.push([0, before.content.size, 0, after.content.size]);
  }
  const old = new Linear(kind, before), next = new Linear(kind, after);
  // Forward: before range k the text already equals `after`, so a new-document offset is a text offset.
  ranges.forEach(([oldStart, oldEnd, newStart, newEnd], index) => {
    const clip = index + 1 < ranges.length ? next.offset(ranges[index + 1]![2]) : next.length;
    writeRange(text, old, next, old.offset(oldStart), old.offset(oldEnd), next.offset(newStart), next.offset(newEnd), clip);
  });
}

const char = (linear: Linear, offset: number) => (offset >= 0 && offset < linear.length ? linear.units(offset, offset + 1)[0]?.ch : undefined);
const differences = (have: Attrs, want: Unit) => keysOf(want.ch).filter((key) => (have[key] ?? null) !== (want.attrs[key] ?? null)).length;

/**
 * Where an edit of only line ends goes. Inserting or deleting "\n"s next to a "\n" gives the same characters at any
 * place in that run of them, but each place keeps different existing line ends, and those carry their blocks' ids and
 * attributes (a code block's continuation) and the text peers are typing before them. The edit takes the place that
 * leaves the fewest block attributes to rewrite on the line ends it keeps. On a tie, an insertion goes one line end to
 * the right (Enter at a block's end keeps the block's own "\n" with its text), then at the step's own place; a
 * deletion takes the step's own line end (Backspace in an empty block removes the "\n" the editor removed, so a
 * peer's typing in the block after stays there); both then go on to the right. Sliding to the far end of a run of
 * empty blocks handed their line ends, and the typing in them, to the wrong block.
 * Only line ends move: everywhere else the step's own position is the user's.
 * `offset` is in the new text; `runEnd` is the end of the run in the new text, the last line end this can affect.
 */
function place(old: Linear, next: Linear, base: number, from: number, inserted: number, deleted: number, clip: number): { offset: number; runEnd: number } {
  let last = from;
  // Each move passes one line end, which must be one in both texts (a code line end joined into a paragraph is not).
  if (inserted && !deleted) while (last + inserted < Math.min(clip, next.length) && char(next, last) === '\n' && char(next, last + inserted) === '\n' && char(old, last - base) === '\n') last++;
  if (deleted && !inserted) while (last < clip && last - base + deleted < old.length && char(old, last - base) === '\n' && char(old, last - base + deleted) === '\n' && char(next, last) === '\n') last++;
  const runEnd = last + inserted;
  if (last === from) return { offset: from, runEnd };
  // A kept line end at new offset o was old o - base before the edit's place, and old o - base - inserted + deleted
  // after it. Moving the place one right moves the line end at new offset `place` from after it to before it.
  const wanted = next.units(from, runEnd), had = old.units(from - base, last - base + deleted);
  const cost = (o: number, oldOffset: number) => differences(had[oldOffset - from + base]!.attrs, wanted[o - from]!);
  let current = 0;
  for (let o = from + inserted; o < runEnd; o++) current += cost(o, o - base - inserted + deleted);
  const costs = [current];
  for (let at = from; at < last; at++) costs.push(current += cost(at, at - base) - cost(at + inserted, at - base + deleted));
  // costs[k] is the place from + k, in tie order.
  const order = inserted ? [1, 0, ...Array.from({ length: costs.length - 2 }, (_unused, i) => i + 2)] : [...costs.keys()];
  let best = order[0]!;
  for (const k of order) if (costs[k]! < costs[best]!) best = k;
  return { offset: from + best, runEnd };
}

function writeRange(text: Y.Text, old: Linear, next: Linear, oldFrom: number, oldTo: number, start: number, newTo: number, clip: number): void {
  const before = old.units(oldFrom, oldTo), after = next.units(start, newTo);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix]!.ch === after[prefix]!.ch) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix]!.ch === after[after.length - 1 - suffix]!.ch) suffix++;
  const deleted = before.length - prefix - suffix, inserted = after.length - prefix - suffix;
  const base = start - oldFrom;
  const at = place(old, next, base, start + prefix, inserted, deleted, clip);
  if (deleted) text.delete(at.offset, deleted);
  if (inserted) insertUnits(text, at.offset, next.units(at.offset, at.offset + inserted));
  // Attributes: the range itself with every line end the edit could have gone past, and every line end of the block
  // it ends in (a join or an open paste changes that block's attributes, which a code block keeps on each of its lines
  // and its ids on the last); characters past them keep theirs.
  const rangeEnd = Math.min(clip, Math.max(newTo, at.runEnd));
  const blockEnd = Math.min(clip, next.blockEnd(Math.max(start, rangeEnd - 1)));
  const lineEnds = next.units(rangeEnd, blockEnd).flatMap((unit, i) => (unit.ch === '\n' ? [rangeEnd + i] : []));
  const offsets = [...Array.from({ length: rangeEnd - start }, (_unused, i) => start + i), ...lineEnds];
  const oldAt = (offset: number) => (offset < at.offset ? offset - base : offset - base - inserted + deleted);
  // A join can carry the rest of a code block into the paragraph before it: that text's inner line ends are spaces
  // in a paragraph, so where its characters changed they are rewritten (only then: it is the rest of a block).
  if (blockEnd > rangeEnd && next.blockAt(blockEnd - 1).type.name !== 'code_block' && old.blockAt(oldAt(blockEnd - 1)).type.name === 'code_block') {
    for (let offset = rangeEnd; offset < blockEnd - 1; offset++) {
      const [want] = next.units(offset, offset + 1), [have] = old.units(oldAt(offset), oldAt(offset) + 1);
      if (want && have && want.ch !== have.ch) { text.delete(offset, 1); insertUnits(text, offset, [want]); }
    }
  }
  const formats: [number, Attrs][] = [];
  for (const offset of offsets) {
    if (offset >= at.offset && offset < at.offset + inserted) continue;
    // From the whole document: a slid edit reaches past the step's own range.
    const want = next.units(offset, offset + 1)[0];
    const have = old.units(oldAt(offset), oldAt(offset) + 1)[0];
    if (!want || !have) continue;
    const change: Attrs = {};
    for (const key of keysOf(want.ch)) if ((have.attrs[key] ?? null) !== (want.attrs[key] ?? null)) change[key] = (want.attrs[key] ?? null) as never;
    if (Object.keys(change).length) formats.push([offset, change]);
  }
  for (let i = 0; i < formats.length;) {
    const [from, change] = formats[i]!;
    const key = JSON.stringify(change);
    let j = i + 1;
    while (j < formats.length && formats[j]![0] === from + (j - i) && JSON.stringify(formats[j]![1]) === key) j++;
    text.format(from, j - i, change);
    i = j;
  }
}

interface CheckedEdit { id: string; before: boolean; after: boolean }
const checkedHistory = Symbol('checked-history');

class Binding {
  /** The origin of this editor's own edits: the only one its undo manager tracks. */
  readonly local = { name: 'live-region-editor' };
  /** Edits this editor makes that are not the person's (id dedupe, repairs): never undone. */
  readonly silent = { name: 'live-region-editor-silent' };
  readonly undoManager: Y.UndoManager;
  readonly flushed = new WeakSet<Transaction>();
  view: EditorView | null = null;
  terminated: boolean;
  private writing = false;
  private checkedEdits: CheckedEdit[] = [];
  private restoring: CheckedEdit[] | null = null;
  private selection: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null = null;

  constructor(readonly kind: RegionKind, readonly text: Y.Text, terminated: boolean) {
    this.terminated = terminated;
    this.undoManager = new Y.UndoManager(text, { trackedOrigins: new Set([this.local]) });
    // Formatting normalization can replace Y.Text markers owned by an undo item. Keep the
    // semantic checkbox inverse on that same item, guarded by stable block identity and value.
    const remember = ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) => {
      const edits = (stackItem.meta.get(checkedHistory) ?? []) as CheckedEdit[];
      for (const edit of this.checkedEdits) {
        const prior = edits.find((value) => value.id === edit.id);
        if (prior) prior.after = edit.after;
        else edits.push({ ...edit });
      }
      stackItem.meta.set(checkedHistory, edits);
    };
    this.undoManager.on('stack-item-added', remember);
    this.undoManager.on('stack-item-updated', remember);
    text.doc!.on('beforeTransaction', this.restoreChecked);
    text.doc!.on('beforeAllTransactions', this.capture);
    text.observe(this.receive);
  }

  private restoreChecked = (transaction: Y.Transaction) => {
    if (transaction.origin !== this.undoManager || !this.restoring) return;
    const linear = new Linear(this.kind, readText(this.kind, this.text).doc);
    for (let offset = 0; offset < linear.length; offset++) {
      const unit = linear.units(offset, offset + 1)[0]!;
      if (unit.ch !== '\n') continue;
      const edit = this.restoring.find((value) => value.id === unit.attrs.afId);
      if (edit && typeof unit.attrs.checked === 'boolean') this.text.format(offset, 1, { checked: edit.before });
    }
  };

  history(redo: boolean): boolean {
    const stack = redo ? this.undoManager.redoStack : this.undoManager.undoStack;
    const item = stack.at(-1);
    if (!item) return false;
    const edits = (item.meta.get(checkedHistory) ?? []) as CheckedEdit[];
    const current = readText(this.kind, this.text).doc;
    this.restoring = edits.filter((edit) => {
      let matches = false;
      current.forEach((node) => { if (node.attrs.afId === edit.id && node.attrs.checked === edit.after) matches = true; });
      return matches;
    });
    this.checkedEdits = this.restoring.map((edit) => ({ id: edit.id, before: edit.after, after: edit.before }));
    try { return (redo ? this.undoManager.redo() : this.undoManager.undo()) !== null || this.restoring.length > 0; }
    finally { this.restoring = null; this.checkedEdits = []; }
  }

  private get doc(): Y.Doc { return this.text.doc!; }

  /** Before anything else changes the text, remember the selection in Yjs terms. */
  private capture = () => {
    if (this.writing || !this.view) return;
    const { selection, doc } = this.view.state;
    const linear = new Linear(this.kind, doc);
    this.selection = { anchor: this.relative(linear.offset(selection.anchor)), head: this.relative(linear.offset(selection.head)) };
  };
  relative(offset: number): Y.RelativePosition { return Y.createRelativePositionFromTypeIndex(this.text, Math.min(offset, this.text.length)); }
  absolute(position: Y.RelativePosition, linear: Linear): number | null {
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.doc);
    return absolute && absolute.type === this.text ? linear.pos(absolute.index) : null;
  }

  /** A change that is not this editor's own (a peer's, or an undo): show it. */
  private receive = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (transaction.origin === this.local || transaction.origin === this.silent || !this.view) return;
    this.render();
  };

  private render(): void {
    const view = this.view!;
    const embeds: number[] = [];
    let offset = 0;
    for (const op of this.text.toDelta() as { insert: unknown }[]) {
      if (typeof op.insert === 'string') offset += op.insert.length;
      else embeds.push(offset++);
    }
    if (embeds.length) this.write(this.silent, () => { for (const at of embeds.reverse()) this.text.delete(at, 1); });
    const { doc: next, terminated } = readText(this.kind, this.text);
    this.terminated = terminated;
    this.repair(next, terminated);
    const previous = view.state.doc;
    let first = 0;
    while (first < previous.childCount && first < next.childCount && previous.child(first).eq(next.child(first))) first++;
    let lastPrevious = previous.childCount, lastNext = next.childCount;
    while (lastPrevious > first && lastNext > first && previous.child(lastPrevious - 1).eq(next.child(lastNext - 1))) { lastPrevious--; lastNext--; }
    let from = 0;
    for (let i = 0; i < first; i++) from += previous.child(i).nodeSize;
    let to = from;
    for (let i = first; i < lastPrevious; i++) to += previous.child(i).nodeSize;
    const blocks: PMNode[] = [];
    for (let i = first; i < lastNext; i++) blocks.push(next.child(i));
    const tr = view.state.tr;
    if (first < lastPrevious || first < lastNext) tr.replaceWith(from, to, blocks);
    if (this.selection) {
      const linear = new Linear(this.kind, tr.doc);
      const anchor = this.absolute(this.selection.anchor, linear), head = this.absolute(this.selection.head, linear);
      if (anchor !== null && head !== null) tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)));
      else tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.selection.head, tr.doc.content.size))));
    }
    view.dispatch(tr.setMeta(bindingKey, { remote: true }).setMeta('addToHistory', false));
  }

  /**
   * Makes the shared text hold exactly what its document shows. Concurrent edits can leave attributes the document
   * cannot: a mark on text another person turned into code, a block attribute that a format marker extended over
   * text typed next to it, a list depth whose list was removed. Every editor that reads such a state writes the same
   * normalization, untracked, so the replicas converge on text that matches their editors exactly.
   */
  private repair(doc: PMNode, terminated: boolean): void {
    const wanted = documentUnits(this.kind, doc);
    if (!terminated) wanted.pop();
    const formats: [number, number, Attrs][] = [];
    let offset = 0;
    for (const op of this.text.toDelta() as { insert: string; attributes?: Attrs }[]) {
      const have = op.attributes ?? {};
      for (let i = 0; i < op.insert.length; i++, offset++) {
        const want = wanted[offset];
        if (!want) continue;
        const change: Attrs = {};
        for (const key of new Set([...Object.keys(have), ...Object.keys(want.attrs)])) if ((have[key] ?? null) !== (want.attrs[key] ?? null)) change[key] = (want.attrs[key] ?? null) as never;
        if (!Object.keys(change).length) continue;
        const last = formats.at(-1);
        if (last && last[0] + last[1] === offset && JSON.stringify(last[2]) === JSON.stringify(change)) last[1]++;
        else formats.push([offset, 1, change]);
      }
    }
    if (formats.length) this.write(this.silent, () => { for (const [at, length, change] of formats) this.text.format(at, length, change); });
  }

  private write(origin: object, change: () => void): void {
    this.writing = true;
    try { this.doc.transact(change, origin); } finally { this.writing = false; }
  }

  /** Sends this editor's transactions, in order, step by step. */
  flush(state: EditorState): void {
    const pending = bindingKey.getState(state)!.pending.filter((tr) => !this.flushed.has(tr));
    for (const tr of pending) this.flushed.add(tr);
    const changes = pending.filter((tr) => tr.docChanged);
    for (let start = 0; start < changes.length;) {
      const tracked = changes[start]!.getMeta('addToHistory') !== false;
      let end = start + 1;
      while (end < changes.length && (changes[end]!.getMeta('addToHistory') !== false) === tracked) end++;
      const group = changes.slice(start, end);
      const before = new Map<string, boolean>();
      group[0]!.before.forEach((node) => { if (typeof node.attrs.checked === 'boolean') before.set(node.attrs.afId, node.attrs.checked); });
      group.at(-1)!.doc.forEach((node) => {
        const previous = before.get(node.attrs.afId);
        if (tracked && previous !== undefined && typeof node.attrs.checked === 'boolean' && previous !== node.attrs.checked)
          this.checkedEdits.push({ id: node.attrs.afId, before: previous, after: node.attrs.checked });
      });
      this.write(tracked ? this.local : this.silent, () => {
        if (!this.terminated) { this.text.insert(this.text.length, '\n', {}); this.terminated = true; }
        for (const tr of group) tr.steps.forEach((step, index) => writeStep(this.text, this.kind, step, tr.docs[index]!, index + 1 < tr.docs.length ? tr.docs[index + 1]! : tr.doc));
      });
      this.checkedEdits = [];
      start = end;
    }
  }

  destroy(): void {
    this.text.unobserve(this.receive);
    this.doc.off('beforeAllTransactions', this.capture);
    this.doc.off('beforeTransaction', this.restoreChecked);
    this.undoManager.destroy();
    this.view = null;
  }
}

/** The binding plugin of an editor on a region's text. `terminated` is whether the text read ended with its "\n". */
export function bindingPlugin(kind: RegionKind, text: Y.Text, terminated: boolean): Plugin<BindingState> {
  const binding = new Binding(kind, text, terminated);
  return new Plugin<BindingState>({
    key: bindingKey,
    state: {
      init: () => ({ binding, pending: [] }),
      apply: (tr, value) => {
        const pending = value.pending.filter((done) => !binding.flushed.has(done));
        return { binding, pending: tr.getMeta(bindingKey)?.remote || !tr.docChanged ? pending : [...pending, tr] };
      },
    },
    view: (view) => {
      binding.view = view;
      return { update: () => binding.flush(view.state), destroy: () => binding.destroy() };
    },
  });
}

const bindingOf = (state: EditorState) => bindingKey.getState(state)?.binding;
export const undo: Command = (state) => { const binding = bindingOf(state); return !!binding && binding.history(false); };
export const redo: Command = (state) => { const binding = bindingOf(state); return !!binding && binding.history(true); };
/** Ends the current undo step: the next edit starts a new one. */
export function stopCapturing(state: EditorState): void { bindingOf(state)?.undoManager.stopCapturing(); }

/** A document position as a Yjs relative position (for cursors and presence), and back. */
export function relativePosition(state: EditorState, pos: number): Y.RelativePosition {
  const binding = bindingOf(state)!;
  return binding.relative(new Linear(binding.kind, state.doc).offset(pos));
}
export function absolutePosition(state: EditorState, position: Y.RelativePosition): number | null {
  const binding = bindingOf(state)!;
  return binding.absolute(position, new Linear(binding.kind, state.doc));
}
