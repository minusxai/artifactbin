/**
 * WHERE THE SPA FINDS THE ISLAND DOCUMENT (docs/phase2-architecture.md §7): a property on the story
 * root (`ISLAND_DOCUMENT_KEY`), never a global. `boot.ts` installs it once every island has hydrated;
 * the Solid app reads it when it adopts the element. `boot.ts` only ever calls these two.
 */
import { ISLAND_DOCUMENT_KEY, type IslandDocument, type IslandHost } from './contract';

export function installIslandDocument(root: HTMLElement, doc: IslandDocument): void {
  (root as IslandHost)[ISLAND_DOCUMENT_KEY] = doc;
}

export function islandDocumentOf(root: Element | null | undefined): IslandDocument | null {
  return (root as IslandHost | null | undefined)?.[ISLAND_DOCUMENT_KEY] ?? null;
}
