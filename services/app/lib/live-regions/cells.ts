/**
 * A LIVE DATASET TEXT CELL's shared text (contracts region-sessions CellScope): the region root Y.Text holding the
 * cell's raw string exactly — newlines are characters, there is no line terminator and no format — so a plain-text
 * region's validation (validateRegionUpdate kind `text`) is the cell's. Pure functions of bytes and strings, for the
 * server (state, three-way revision) and the page library `@afbin/collab` (minimal splices of an input's value).
 *
 *  - createCellState: built ONCE by the server from the stored value, with the snapshot of that value.
 *  - applyCellRevision: another write to the dataset (GraphQL, SQL, an upload) changed the cell; the change is
 *    diffed into a fork of the value the cell last saw (its snapshot), word by word, and only the fork's operations
 *    are merged, so nobody's unsaved typing is lost.
 *  - spliceText: an input's new value as the smallest change to the text (common prefix and suffix kept), so a remote
 *    insertion next to the edit stays where it was typed.
 */
import * as Y from 'yjs';
import { diffHunks } from './diff';
import { LiveRegionRefusal } from './refusal';

/** The cell's text in a live document: the region root (lines.ts regionText), named here so the page library loads no schema. */
export const cellText = (doc: Y.Doc): Y.Text => doc.getText('region');
/** The cell's value: the text as it is. */
export const cellValue = (doc: Y.Doc): string => cellText(doc).toString();

const snapshotOf = (doc: Y.Doc): Uint8Array => Y.encodeSnapshot(Y.snapshot(doc));

export function createCellState(value: string): { state: Uint8Array; snapshot: Uint8Array } {
  const doc = new Y.Doc({ gc: false });
  if (value) cellText(doc).insert(0, value);
  return { state: Y.encodeStateAsUpdate(doc), snapshot: snapshotOf(doc) };
}

/** Word, run of spaces, or any other single character: the units a revision is compared in. */
const TOKEN = /[\p{L}\p{N}\p{M}_]+|[ \t]+|[\s\S]/gu;
const tokens = (text: string) => [...text.matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index! }));

/** Rewrites `text` (holding `before`) to `after`, word by word, touching only what changed. */
function rewrite(text: Y.Text, before: string, after: string): void {
  const a = tokens(before), b = tokens(after);
  const at = (list: { start: number }[], index: number, total: number) => (index < list.length ? list[index]!.start : total);
  const hunks = diffHunks(a.map((token) => token.text), b.map((token) => token.text));
  for (const hunk of [...hunks].reverse()) {
    const aStart = at(a, hunk.aStart, before.length), aEnd = at(a, hunk.aEnd, before.length);
    const bStart = at(b, hunk.bStart, after.length), bEnd = at(b, hunk.bEnd, after.length);
    if (aEnd > aStart) text.delete(aStart, aEnd - aStart);
    if (bEnd > bStart) text.insert(aStart, after.slice(bStart, bEnd));
  }
}

/**
 * THE THREE-WAY apply of another write to a live cell: `value` was made from the cell's last seen value (the
 * snapshot), not from the live text, so it is diffed into a fork of that snapshot and only the fork's new operations
 * are merged. Returns the update to apply and broadcast, and the snapshot of `value` (the next revision's base).
 */
export function applyCellRevision(input: { live: Uint8Array; savedSnapshot: Uint8Array | null | undefined; value: string }): { update: Uint8Array; snapshot: Uint8Array; base: string } {
  if (!input.savedSnapshot?.length) throw new LiveRegionRefusal('missing_snapshot');
  const live = new Y.Doc({ gc: false });
  Y.applyUpdate(live, input.live);
  let snapshot: Y.Snapshot;
  try { snapshot = Y.decodeSnapshot(input.savedSnapshot); } catch { throw new LiveRegionRefusal('snapshot_mismatch', ['undecodable']); }
  const known = Y.decodeStateVector(Y.encodeStateVector(live));
  const strangers = [...snapshot.sv].filter(([client, clock]) => (known.get(client) ?? 0) < clock);
  if (strangers.length) throw new LiveRegionRefusal('snapshot_mismatch', strangers.map(([client]) => String(client)));
  const fork = Y.createDocFromSnapshot(live, snapshot);
  const text = cellText(fork), base = text.toString();
  fork.transact(() => rewrite(text, base, input.value));
  return { update: Y.encodeStateAsUpdate(fork, Y.encodeStateVector(live)), snapshot: snapshotOf(fork), base };
}

/** The value a snapshot of a live document holds (the cell as it last saw the dataset). */
export function snapshotValue(live: Y.Doc, snapshot: Uint8Array): string {
  return cellValue(Y.createDocFromSnapshot(live, Y.decodeSnapshot(snapshot)));
}

/** The smallest splice turning `before` into `after`: one deletion and one insertion at `index`, or null. */
export function textSplice(before: string, after: string): { index: number; remove: number; insert: string } | null {
  if (before === after) return null;
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  // Never split a surrogate pair: widen the splice over a half pair on either edge.
  const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
  if (prefix > 0 && high(before.charCodeAt(prefix - 1))) prefix--;
  const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
  if (suffix > 0 && low(before.charCodeAt(before.length - suffix))) suffix--;
  return { index: prefix, remove: before.length - prefix - suffix, insert: after.slice(prefix, after.length - suffix) };
}

/** Applies an input's new value to the text as its smallest splice (in one transaction, with `origin`). */
export function spliceText(text: Y.Text, after: string, origin?: unknown): boolean {
  const splice = textSplice(text.toString(), after);
  if (!splice) return false;
  text.doc!.transact(() => {
    if (splice.remove) text.delete(splice.index, splice.remove);
    if (splice.insert) text.insert(splice.index, splice.insert);
  }, origin);
  return true;
}
