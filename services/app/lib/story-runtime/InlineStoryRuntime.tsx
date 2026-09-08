import type { ReactNode } from 'react';
import type { StoryDocumentUpdate, StoryEditParentMessage, StoryIslandData } from './contract';
import type { QueryTransport } from './store';

/** Private, instance-scoped application/runtime endpoint. Never published on window or sent to author frames. */
export interface InlineStoryController {
  send(command: StoryEditParentMessage): void;
  update(document: StoryDocumentUpdate): void;
  invalidate(datasets: string[]): void;
  subscribe(listener: (event: unknown) => void): () => void;
  getViewportRect(): DOMRect;
  dispose(): void;
}

export interface InlineStoryRuntimeProps {
  data: StoryIslandData;
  transport: QueryTransport;
  authorScript?: string | null;
  onController(controller: InlineStoryController | null): void;
}

/** Top-level artifact body; only authored Iframe/Helmet code creates sandboxed child realms. */
export function InlineStoryRuntime(_props: InlineStoryRuntimeProps): ReactNode {
  throw new Error('seamless-navigation: implement inline runtime');
}
