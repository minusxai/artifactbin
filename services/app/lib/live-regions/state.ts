/**
 * A region's shared state: one Yjs document per region holding ONE Y.Text (lines.ts), built once by the server from
 * the saved HTML and kept with `gc: false`, so every saved version's snapshot can be reopened for as long as it is
 * kept. Everything here is a pure function of bytes: states, updates and snapshots go in and come out as `Uint8Array`.
 */
import * as Y from 'yjs';
import { createNativeState, nativeHtml, nativeDocument, reviseNative } from './native-state';
import { nativeMarkdownJson } from './native-markdown';
import { nativeSchema } from './native-schema';
import { readNativeHtml, writeNativeHtml } from './native-html';
import type { Node as PMNode } from 'prosemirror-model';
import { alignPairs, diffHunks, similarity } from './diff';
import { readRegion, writeRegion } from './html';
import { documentUnits, insertUnits, keysOf, Linear, readText, type Attrs, type Unit } from './lines';
import { forkRegionDoc, openRegionDoc, regionText } from './region-doc';
import { LiveRegionRefusal } from './refusal';
import { ID_ATTRS, regionSchema, type RegionKind } from './schema';
import { htmlSource, markdownSource } from './source-html';

/** The merged document, read through the schema: always valid, whatever peers wrote. */
export const readDocument = (kind: RegionKind, doc: Y.Doc): PMNode => kind === 'rich-native-v1' ? nativeDocument(doc) : readText(kind, regionText(doc)).doc;

/** A region's normal form: what publish stores for it. Refuses content the kind cannot hold. */
export function normalizeRegionHtml(kind: RegionKind, html: string): string {
  if (kind === 'rich-native-v1') return writeNativeHtml(readNativeHtml(html));
  return writeRegion(kind, readRegion(kind, htmlSource(html), 'refuse'));
}

/**
 * The region's initial shared state, built from its saved HTML, and the saved version's snapshot. Built ONCE, by the
 * server: every client starts from these bytes, never from its own parse (two parses are two sets of insertions, and
 * the content would double).
 */
export function createRegionState(kind: RegionKind, html: string): { state: Uint8Array; snapshot: Uint8Array } {
  if (kind === 'rich-native-v1') return createNativeState(html);
  const doc = openRegionDoc();
  insertUnits(regionText(doc), 0, documentUnits(kind, readRegion(kind, htmlSource(html), 'refuse')));
  return { state: Y.encodeStateAsUpdate(doc), snapshot: encodeSnapshot(doc) };
}

/** The region HTML of a state, in normal form, sanitized. */
export function regionHtml(kind: RegionKind, state: Uint8Array): string {
  if (kind === 'rich-native-v1') return nativeHtml(state);
  return writeRegion(kind, readDocument(kind, openRegionDoc(state)));
}

export const encodeSnapshot = (doc: Y.Doc): Uint8Array => Y.encodeSnapshot(Y.snapshot(doc));

/** A text whose last line lost its "\n" to concurrent deletions gets it back before anyone writes past it. */
function terminate(kind: RegionKind, text: Y.Text): PMNode {
  const { doc, terminated } = readText(kind, text);
  if (!terminated) text.insert(text.length, '\n', {});
  return doc;
}

const lines = (units: readonly Unit[]): Unit[][] => {
  const out: Unit[][] = [];
  let line: Unit[] = [];
  for (const unit of units) { line.push(unit); if (unit.ch === '\n') { out.push(line); line = []; } }
  return out;
};
const changes = (have: Attrs, want: Unit): Attrs | null => {
  const change: Attrs = {};
  for (const key of keysOf(want.ch)) if ((have[key] ?? null) !== (want.attrs[key] ?? null)) change[key] = (want.attrs[key] ?? null) as never;
  return Object.keys(change).length ? change : null;
};

/** Word, run of spaces, or any other single character: the units a line is compared in. */
const TOKEN = /[\p{L}\p{N}\p{M}_]+|[ \t]+|[\s\S]/gu;
function tokens(units: readonly Unit[]): { text: string; start: number }[] {
  const text = units.map((unit) => unit.ch).join('');
  return [...text.matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index! }));
}
/** The differing ranges of two lines, in units, found word by word (a rewritten word is replaced whole, so text
 * someone typed next to it stays next to it instead of landing between two of its letters). */
function lineHunks(before: readonly Unit[], after: readonly Unit[]) {
  const a = tokens(before), b = tokens(after);
  const at = (list: { start: number }[], index: number, total: number) => (index < list.length ? list[index]!.start : total);
  return diffHunks(a.map((token) => token.text), b.map((token) => token.text)).map((hunk) => ({
    aStart: at(a, hunk.aStart, before.length), aEnd: at(a, hunk.aEnd, before.length),
    bStart: at(b, hunk.bStart, after.length), bEnd: at(b, hunk.bEnd, after.length),
  }));
}

/** One line rewritten in place at `start`: a word diff, then the attributes of what it kept. */
function rewriteLine(text: Y.Text, start: number, before: readonly Unit[], after: readonly Unit[]): void {
  const hunks = lineHunks(before, after);
  for (const hunk of [...hunks].reverse()) {
    if (hunk.aEnd > hunk.aStart) text.delete(start + hunk.aStart, hunk.aEnd - hunk.aStart);
    if (hunk.bEnd > hunk.bStart) insertUnits(text, start + hunk.aStart, after.slice(hunk.bStart, hunk.bEnd));
  }
  // Kept units: before index i ↔ after index j between the hunks.
  let i = 0, j = 0;
  const kept = (count: number) => {
    for (let k = 0; k < count; k++, i++, j++) { const change = changes(before[i]!.attrs, after[j]!); if (change) text.format(start + j, 1, change); }
  };
  for (const hunk of hunks) { kept(hunk.aStart - i); i = hunk.aEnd; j = hunk.bEnd; }
  kept(before.length - i);
}

const lineText = (line: readonly Unit[]) => line.map((unit) => unit.ch).join('');
const lineId = (line: readonly Unit[]) => { const id = line.at(-1)?.attrs.afId; return typeof id === 'string' ? id : null; };
/**
 * Which old line a new line rewrites, within a group of changed lines: the same block id first; then the most alike
 * by words; then, failing both, position. Lines with different ids never pair (one block deleted, another added).
 */
function lineScore(before: readonly Unit[], after: readonly Unit[]): number {
  const a = lineId(before), b = lineId(after);
  if (a && b) return a === b ? 1000 : -Infinity;
  const alike = similarity(lineText(before), lineText(after));
  return alike >= 0.3 ? 10 * alike : 0.01;
}

/**
 * Rewrites a region's text to `target`: a line diff; inside each group of changed lines, lines paired by id, words,
 * then position (lineScore); each pair rewritten word by word with its attributes, the rest deleted or inserted.
 * Only what changed is touched, so other people's concurrent typing (merged later) stays in the block it was typed
 * in; a deleted line takes only its own characters with it.
 */
function rewrite(kind: RegionKind, text: Y.Text, target: PMNode): void {
  const base = terminate(kind, text);
  const before = lines(documentUnits(kind, base)), after = lines(documentUnits(kind, target));
  const key = (line: readonly Unit[]) => JSON.stringify(line);
  const starts: number[] = [];
  let offset = 0;
  for (const line of before) { starts.push(offset); offset += line.length; }
  starts.push(offset);
  const hunks = diffHunks(before.map(key), after.map(key));
  type Op = { pair: [number, number] } | { remove: number } | { add: number; at: number };
  for (const hunk of [...hunks].reverse()) {
    const pairs = alignPairs(hunk.aEnd - hunk.aStart, hunk.bEnd - hunk.bStart, (i, j) => lineScore(before[hunk.aStart + i]!, after[hunk.bStart + j]!));
    const ops: Op[] = [];
    let i = hunk.aStart, j = hunk.bStart;
    for (const [pi, pj] of [...pairs.map(([a, b]) => [hunk.aStart + a, hunk.bStart + b] as const), [hunk.aEnd, hunk.bEnd] as const]) {
      for (; i < pi; i++) ops.push({ remove: i });
      for (; j < pj; j++) ops.push({ add: j, at: i });
      if (pi < hunk.aEnd) { ops.push({ pair: [pi, pj] }); i++; j++; }
    }
    // Last first: every op touches only text at or after its own old line's start.
    for (const op of ops.reverse()) {
      if ('pair' in op) rewriteLine(text, starts[op.pair[0]]!, before[op.pair[0]]!, after[op.pair[1]]!);
      else if ('remove' in op) text.delete(starts[op.remove]!, before[op.remove]!.length);
      else insertUnits(text, starts[op.at]!, after[op.add]!);
    }
  }
}

const withoutIds = (block: PMNode): PMNode => {
  const attrs: Record<string, unknown> = { ...block.attrs };
  for (const name of ID_ATTRS) if (name in attrs) attrs[name] = null;
  return block.type.create(attrs, block.content, block.marks);
};
const hasIds = (block: PMNode) => ID_ATTRS.some((name) => typeof block.attrs[name] === 'string');

/** Index pairs of a longest common subsequence of two key lists. */
function commonSubsequence(a: readonly string[], b: readonly string[]): [number, number][] {
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i++; else j++;
  }
  return pairs;
}

/**
 * The revision, except that each block it leaves unchanged is the base's own node. The saved HTML is normal form
 * (whitespace collapsed); the base is what people typed, so diffing a block whose normal form is the same would only
 * delete someone's trailing space mid-word. A revision with ids (a republished page) is matched by id. One without
 * any (an agent's Markdown) is matched by content; a changed block between two matches takes the ids of the base
 * block in its place, so the blocks an agent rewrites keep their identities, as canonicalizeHtmlPage's carry-over would.
 */
function keepUnchanged(kind: RegionKind, base: PMNode, revision: PMNode): PMNode {
  if (kind === 'text') return writeRegion(kind, base) === writeRegion(kind, revision) ? base : revision;
  const schema = regionSchema(kind);
  const normal = (block: PMNode) => writeRegion(kind, schema.nodes.doc!.create(null, block));
  const baseBlocks: PMNode[] = [], revisionBlocks: PMNode[] = [];
  base.forEach((block) => { baseBlocks.push(block); });
  revision.forEach((block) => { revisionBlocks.push(block); });
  let blocks: PMNode[];
  if (revisionBlocks.some(hasIds)) {
    const byId = new Map(baseBlocks.filter((block) => block.attrs.afId).map((block) => [block.attrs.afId as string, block]));
    blocks = revisionBlocks.map((block) => { const own = block.attrs.afId ? byId.get(block.attrs.afId) : undefined; return own && normal(own) === normal(block) ? own : block; });
  } else {
    const key = (block: PMNode) => normal(withoutIds(block));
    const pairs = commonSubsequence(baseBlocks.map(key), revisionBlocks.map(key));
    blocks = revisionBlocks.slice();
    const anchors: [number, number][] = [[-1, -1], ...pairs, [baseBlocks.length, revisionBlocks.length]];
    for (let k = 0; k + 1 < anchors.length; k++) {
      const [i, j] = anchors[k]!, [nextI, nextJ] = anchors[k + 1]!;
      if (k > 0) blocks[j] = baseBlocks[i]!;
      // The blocks between two matches pair by words, then position; a pair carries the base block's ids.
      const gapBase = baseBlocks.slice(i + 1, nextI), gapRevision = revisionBlocks.slice(j + 1, nextJ);
      for (const [a, b] of alignPairs(gapBase.length, gapRevision.length, (x, y) => {
        if (gapBase[x]!.type !== gapRevision[y]!.type) return -Infinity;
        const alike = similarity(gapBase[x]!.textContent, gapRevision[y]!.textContent);
        return alike >= 0.3 ? 10 * alike : 0.01;
      })) {
        const own = gapBase[a]!, block = gapRevision[b]!;
        const attrs: Record<string, unknown> = { ...block.attrs };
        for (const name of ID_ATTRS) if (name in attrs && name in own.attrs) attrs[name] = own.attrs[name];
        blocks[j + 1 + b] = block.type.create(attrs, block.content, block.marks);
      }
    }
  }
  return schema.nodes.doc!.create(null, blocks);
}

interface RegionRevisionInput {
  kind: RegionKind;
  /** The live state now. */
  live: Uint8Array;
  /** The snapshot kept with the saved version the revision was made from; null or absent when none is kept. */
  savedSnapshot: Uint8Array | null | undefined;
  /** The revised region: inner HTML, or (for agents) Markdown. Exactly one. */
  html?: string;
  markdown?: string;
}
interface RegionRevision {
  /** Apply to the live state and broadcast: only the revision's own changes. */
  update: Uint8Array;
  /** The snapshot of the version the revision becomes, for the next revision. */
  snapshot: Uint8Array;
}

/**
 * The THREE-WAY apply of a republish or an agent edit. The revision was made from a saved version, not from the live
 * state: diffing it against the live state would treat everyone's synced, unsaved typing as deleted. So the saved
 * version is reopened from its snapshot, the revision is diffed into that fork (a line and character diff of its
 * text), and only the fork's new operations are merged. A revision without a snapshot is refused.
 */
export function applyRegionRevision(input: RegionRevisionInput): RegionRevision {
  const { kind } = input;
  if ((input.html === undefined) === (input.markdown === undefined)) throw new TypeError('applyRegionRevision takes exactly one of html or markdown');
  if (kind === 'rich-native-v1') {
    return reviseNative(input.live, input.savedSnapshot, input.html ?? writeNativeHtml(nativeSchema.nodeFromJSON(nativeMarkdownJson(input.markdown!))));
  }
  const revision = readRegion(kind, input.html !== undefined ? htmlSource(input.html) : markdownSource(input.markdown!, kind), 'refuse');
  if (!input.savedSnapshot?.length) throw new LiveRegionRefusal('missing_snapshot');
  const live = openRegionDoc(input.live);
  let snapshot: Y.Snapshot;
  try { snapshot = Y.decodeSnapshot(input.savedSnapshot); } catch { throw new LiveRegionRefusal('snapshot_mismatch', ['undecodable']); }
  if (!snapshot.sv.size) throw new LiveRegionRefusal('missing_snapshot');
  // Every saved version holds the region's first insertion (the one made into an empty text): a snapshot that
  // does not would reopen as an empty region, and the revision would be inserted a second time.
  for (let item = regionText(live)._start; item; item = item.right) {
    if (item.origin === null && item.rightOrigin === null && (snapshot.sv.get(item.id.client) ?? 0) <= item.id.clock) throw new LiveRegionRefusal('snapshot_mismatch', ['does not cover the initial state']);
  }
  const known = Y.decodeStateVector(Y.encodeStateVector(live));
  const strangers = [...snapshot.sv].filter(([client, clock]) => (known.get(client) ?? 0) < clock);
  if (strangers.length) throw new LiveRegionRefusal('snapshot_mismatch', strangers.map(([client]) => String(client)));
  const fork = forkRegionDoc(live, snapshot);
  const text = regionText(fork);
  fork.transact(() => rewrite(kind, text, keepUnchanged(kind, readText(kind, text).doc, revision)));
  return { update: Y.encodeStateAsUpdate(fork, Y.encodeStateVector(live)), snapshot: encodeSnapshot(fork) };
}

/** Writes the given ids onto a state's own blocks (block i takes block i's ids), as an update; nothing else changes. */
export function writeIds(kind: RegionKind, doc: Y.Doc, ids: readonly Record<string, string | null>[]): Uint8Array {
  const before = Y.encodeStateVector(doc);
  if (kind === 'rich') {
    const text = regionText(doc);
    doc.transact(() => {
      const linear = new Linear(kind, terminate(kind, text));
      linear.blocks.forEach((block, index) => {
        const end = block.offset + block.length - 1;
        const [unit] = linear.units(end, end + 1);
        const wanted: Unit = { ch: '\n', attrs: { ...unit!.attrs } };
        for (const name of ID_ATTRS) { const id = ids[index]?.[name]; if (id) wanted.attrs[name] = id; else delete wanted.attrs[name]; }
        const change = changes(unit!.attrs, wanted);
        if (change) text.format(end, 1, change);
      });
    });
  }
  return Y.encodeStateAsUpdate(doc, before);
}
