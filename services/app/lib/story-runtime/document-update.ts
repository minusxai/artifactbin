/**
 * Whether a message posted into the document is a new version of it (`mx:document`).
 * The island controller and the local preview's controller adopt what passes.
 */
import { STORY_DOCUMENT_MESSAGE, type StoryDocumentUpdate } from './contract';

/**
 * Is this message a document update? Callers check the source; this checks the SHAPE, because a page
 * embedding us is not the only thing that can post into a window.
 */
export function isStoryDocumentUpdate(data: unknown): data is StoryDocumentUpdate {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<StoryDocumentUpdate>;
  return d.type === STORY_DOCUMENT_MESSAGE && Array.isArray(d.nodes);
}
