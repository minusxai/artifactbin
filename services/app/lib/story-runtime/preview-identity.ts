import type { JsxNode } from '@/lib/jsx';
import type { StoryInterpreterOptions } from '@/lib/story-ui/interpreter';

/** One allocator per rail instance. All document IDs exclude collisions; each
 * local tree gets its own stable namespace. Only local references are rewritten.
 * No mutation of the input AST, source IDs, or React keys is permitted. */
export function createPreviewIdentityAllocator(documentNodes: JsxNode[], instanceKey: string):
  (localNodes: JsxNode[], previewKey: string) => NonNullable<StoryInterpreterOptions['decorateElement']> {
  void documentNodes; void instanceKey;
  throw new Error('preview-identity: implement');
}
