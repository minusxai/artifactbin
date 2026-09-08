import type { StoryDocumentUpdate, StoryIslandData } from './contract';

/** Explicit references supplied by trusted app code, never author DOM IDs. */
export interface StoryMountOptions {
  root: HTMLElement;
  data: StoryIslandData;
  renderMode: 'render' | 'hydrate';
  authorScript?: string | null;
  /** Existing frame protocol peer; the first-party shell can be same-window. */
  peer?: Window;
  peerOrigin: string;
}
export interface MountedStory {
  adopt(update: StoryDocumentUpdate): void;
  dispose(): void;
}

/** One lifecycle for the served document entry and SPA artifact routes. */
export function mountStory(_options: StoryMountOptions): MountedStory {
  throw new Error('mountStory: implement shared runtime lifecycle');
}
