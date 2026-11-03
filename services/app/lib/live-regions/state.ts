/**
 * A region's shared state: one Yjs document per region, built once by the server from the saved HTML and kept with
 * `gc: false`, so every saved version's snapshot can be reopened for as long as it is kept. Everything here is a
 * pure function of bytes: states, updates and snapshots go in and come out as `Uint8Array`.
 */
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Node as PMNode } from 'prosemirror-model';
import { readRegion, writeRegion } from './html';
import { LiveRegionRefusal } from './refusal';
import { ID_ATTRS, regionSchema, type RegionKind } from './schema';
import { htmlSource, markdownSource } from './source-html';

/** The shared type a region's document is bound through. */
const FRAGMENT = 'region';
export const regionFragment = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(FRAGMENT);

/** A live state as a document that can reopen old snapshots. */
export function liveDocument(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, state);
  return doc;
}

/** The merged tree, read through the schema. Reading may drop elements the schema refuses, so callers read a copy. */
export const readDocument = (kind: RegionKind, doc: Y.Doc): PMNode => yXmlFragmentToProseMirrorRootNode(regionFragment(doc), regionSchema(kind));

/**
 * THE ONE CALL OF `updateYFragment`. y-prosemirror marks it `@private @unstable`; the package is pinned exactly and
 * every path that diffs a tree into a region's state (republish, agent edit, compaction's id write-back) comes
 * through here, so the tests of those paths are its tests.
 */
function diffInto(doc: Y.Doc, target: PMNode): void {
  doc.transact(() => updateYFragment(doc, regionFragment(doc), target, { mapping: new Map(), isOMark: new Map() }));
}

/** A region's normal form: what publish stores for it. Refuses content the kind cannot hold. */
export function normalizeRegionHtml(kind: RegionKind, html: string): string {
  return writeRegion(kind, readRegion(kind, htmlSource(html), 'refuse'));
}

/**
 * The region's initial shared state, built from its saved HTML, and the saved version's snapshot. Built ONCE, by the
 * server: every client starts from these bytes, never from its own parse (two parses are two sets of insertions, and
 * the content would double).
 */
export function createRegionState(kind: RegionKind, html: string): { state: Uint8Array; snapshot: Uint8Array } {
  const doc = new Y.Doc({ gc: false });
  prosemirrorToYXmlFragment(readRegion(kind, htmlSource(html), 'refuse'), regionFragment(doc));
  return { state: Y.encodeStateAsUpdate(doc), snapshot: encodeSnapshot(doc) };
}

/** The region HTML of a state, in normal form, sanitized. */
export function regionHtml(kind: RegionKind, state: Uint8Array): string {
  return writeRegion(kind, readDocument(kind, liveDocument(state)));
}

export const encodeSnapshot = (doc: Y.Doc): Uint8Array => Y.encodeSnapshot(Y.snapshot(doc));

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
      for (let offset = 1; i + offset < nextI && j + offset < nextJ; offset++) {
        const own = baseBlocks[i + offset]!, block = revisionBlocks[j + offset]!;
        if (own.type !== block.type) continue;
        const attrs: Record<string, unknown> = { ...block.attrs };
        for (const name of ID_ATTRS) if (name in attrs && name in own.attrs) attrs[name] = own.attrs[name];
        blocks[j + offset] = block.type.create(attrs, block.content, block.marks);
      }
    }
  }
  return schema.nodes.doc!.create(null, blocks);
}

export interface RegionRevisionInput {
  kind: RegionKind;
  /** The live state now. */
  live: Uint8Array;
  /** The snapshot kept with the saved version the revision was made from; null or absent when none is kept. */
  savedSnapshot: Uint8Array | null | undefined;
  /** The revised region: inner HTML, or (for agents) Markdown. Exactly one. */
  html?: string;
  markdown?: string;
}
export interface RegionRevision {
  /** Apply to the live state and broadcast: only the revision's own changes. */
  update: Uint8Array;
  /** The snapshot of the version the revision becomes, for the next revision. */
  snapshot: Uint8Array;
}

/**
 * The THREE-WAY apply of a republish or an agent edit. The revision was made from a saved version, not from the live
 * state: diffing it against the live state would treat everyone's synced, unsaved typing as deleted. So the saved
 * version is reopened from its snapshot, the revision is diffed into that fork, and only the fork's new operations
 * are merged. A revision without a snapshot is refused.
 */
export function applyRegionRevision(input: RegionRevisionInput): RegionRevision {
  const { kind } = input;
  if ((input.html === undefined) === (input.markdown === undefined)) throw new TypeError('applyRegionRevision takes exactly one of html or markdown');
  const revision = readRegion(kind, input.html !== undefined ? htmlSource(input.html) : markdownSource(input.markdown!), 'refuse');
  if (!input.savedSnapshot?.length) throw new LiveRegionRefusal('missing_snapshot');
  const live = liveDocument(input.live);
  let snapshot: Y.Snapshot;
  try { snapshot = Y.decodeSnapshot(input.savedSnapshot); } catch { throw new LiveRegionRefusal('snapshot_mismatch', ['undecodable']); }
  const known = Y.decodeStateVector(Y.encodeStateVector(live));
  const strangers = [...snapshot.sv].filter(([client, clock]) => (known.get(client) ?? 0) < clock);
  if (strangers.length) throw new LiveRegionRefusal('snapshot_mismatch', strangers.map(([client]) => String(client)));
  const fork = Y.createDocFromSnapshot(live, snapshot);
  diffInto(fork, keepUnchanged(kind, readDocument(kind, liveDocument(Y.encodeStateAsUpdate(fork))), revision));
  return { update: Y.encodeStateAsUpdate(fork, Y.encodeStateVector(live)), snapshot: encodeSnapshot(fork) };
}

/** Writes the given ids onto a state's own blocks (block i takes block i's ids), as an update; nothing else changes. */
export function writeIds(kind: RegionKind, doc: Y.Doc, ids: readonly Record<string, string | null>[]): Uint8Array {
  const before = Y.encodeStateVector(doc);
  const current = readDocument(kind, liveDocument(Y.encodeStateAsUpdate(doc)));
  if (kind === 'rich') {
    const blocks: PMNode[] = [];
    current.forEach((block, _offset, index) => {
      const next = ids[index] ?? {};
      const attrs: Record<string, unknown> = { ...block.attrs };
      for (const name of ID_ATTRS) if (name in block.type.spec.attrs!) attrs[name] = next[name] ?? null;
      blocks.push(block.type.create(attrs, block.content, block.marks));
    });
    diffInto(doc, regionSchema(kind).nodes.doc!.create(null, blocks));
  }
  return Y.encodeStateAsUpdate(doc, before);
}
