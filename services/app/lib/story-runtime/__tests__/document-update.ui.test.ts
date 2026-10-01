/** Which messages posted into a document count as a new version of it. */
import { describe, expect, it } from 'vitest';
import { STORY_DOCUMENT_MESSAGE } from '../contract';
import { isStoryDocumentUpdate } from '../document-update';

describe('isStoryDocumentUpdate', () => {
  it('accepts a well-formed update', () => {
    expect(isStoryDocumentUpdate({ type: STORY_DOCUMENT_MESSAGE, nodes: [] })).toBe(true);
  });

  it('rejects anything else that might be posted into a window', () => {
    for (const junk of [null, undefined, 0, 'mx:document', [], {}, { type: 'mx:query', nodes: [] },
      { type: STORY_DOCUMENT_MESSAGE }, { type: STORY_DOCUMENT_MESSAGE, nodes: 'not-an-array' }]) {
      expect(isStoryDocumentUpdate(junk)).toBe(false);
    }
  });
});
