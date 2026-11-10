/**
 * THE ONE WAY A REGION OR CELL DOCUMENT IS OPENED, on the server, in the page frame and in tests: its root text
 * (`region`) is obtained FIRST, and only then is any state applied.
 *
 * Why the order matters (Yjs 13.6): a root that an update reaches before `getText` names it is integrated as a plain
 * type, so a format item arriving that way never switches its search markers off (integrating a format into a known
 * Y.Text does). `getText` then adopts that content with the markers still on. A deletion found through a marker
 * starts with no attributes and its cleanup drops the format ending the attribute run before it, so that run spreads
 * over the text after the deletion: deleting an empty line between `<p af-2>` and `<p af-4>z</p>` gave "z" af-2's id.
 * With the text obtained first every format is integrated into the Y.Text itself and the deletion is exact.
 *
 * Every Yjs document in this repository is a region or cell document, so nothing else constructs one
 * (`new Y.Doc`, or `createDocFromSnapshot` without a target): the guard test region-doc-guard.test.ts scans the
 * sources and fails on any construction outside this file.
 */
import * as Y from 'yjs';
import type { RegionKind } from '@artifactbin/contracts';
const NATIVE_ROOT = 'native-v1';

/** The one root a region's (or a live cell's) state holds. */
export const REGION_ROOT = 'region';

/** The region's shared text in an opened document. */
export const regionText = (doc: Y.Doc): Y.Text => doc.getText(REGION_ROOT);

export interface RegionDocOptions {
  /** Garbage collection. Off by default: a live region keeps its history, so saved snapshots can be reopened. */
  gc?: boolean;
  kind?: RegionKind;
  /** The client id this document writes with (set before any state is applied). */
  clientId?: number;
}

/** A region or cell document: the root text obtained, then `state` (when given) applied. */
export function openRegionDoc(state?: Uint8Array, options: RegionDocOptions = {}): Y.Doc {
  const doc = new Y.Doc({ gc: options.gc ?? false });
  if (options.clientId !== undefined) doc.clientID = options.clientId;
  if (options.kind === 'rich-native-v1') doc.getXmlFragment(NATIVE_ROOT);
  else regionText(doc);
  if (state) Y.applyUpdate(doc, state);
  return doc;
}

/**
 * The document `live` (gc off) was at `snapshot`, opened the same way: a fork a revision is written into. It has
 * garbage collection on, like any throwaway document.
 */
export const forkRegionDoc = (live: Y.Doc, snapshot: Y.Snapshot): Y.Doc => Y.createDocFromSnapshot(live, snapshot, openRegionDoc(undefined, { gc: true, kind: live.share.has(NATIVE_ROOT) ? 'rich-native-v1' : 'rich' }));
