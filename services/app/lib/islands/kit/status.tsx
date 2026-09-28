/* @jsxImportSource solid-js */
/**
 * THE WRITE STATUS INDICATOR SEAM — a no-op until w3-viewer-writes replaces this file with the
 * indicator (`data-mx-write-status`). `boot.ts` calls it once with the document's feed and story
 * root and keeps the returned disposer.
 */
import type { WriteStatusFeed } from '../contract';

export function installStatus(_feed: WriteStatusFeed, _root: HTMLElement): () => void {
  return () => {};
}
