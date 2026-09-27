/**
 * The document's PRERENDERED drawings (StoryIslandData.mermaidImages), keyed by
 * `mermaidImageKey(code, mode)`. Provided around everything a document draws —
 * the deck rail re-renders each slide's nodes — and empty wherever nothing was
 * stored: an editor's draft, an offline file, a document the harvest has not
 * reached. Empty means exactly today's path: the engine draws.
 *
 * Its own module so every story can provide it (lib/story-runtime/
 * StoryRuntimeApp) while `<Mermaid>` (./mermaid) loads only with the documents
 * that draw one (lib/story-runtime/kit-registry).
 */
import { createContext } from 'react';
import type { StoredMermaidImage } from '@/lib/story-runtime/contract';

export const MermaidImagesContext = createContext<Readonly<Record<string, StoredMermaidImage>>>({});
export const MermaidImagesProvider = MermaidImagesContext.Provider;
