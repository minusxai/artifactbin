import type { StoryDocumentInput } from './document';
import type { PreparedStoryRuntime } from './prepared-runtime';

/** Shared preparation for inline app rendering and standalone raw/export rendering. */
export async function prepareStoryRuntime(_input: StoryDocumentInput): Promise<PreparedStoryRuntime> {
  throw new Error('seamless-navigation: implement shared runtime preparation');
}
