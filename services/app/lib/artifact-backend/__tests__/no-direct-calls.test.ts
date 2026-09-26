/**
 * The surface's server calls live behind ArtifactBackend. A direct fetch or
 * EventSource for these routes in the editing/commenting cone would silently
 * fail in an offline file (the file's CSP blocks it), so it is refused here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '../../..');
const CONE = [
  'components/ArtifactEditor.tsx',
  'components/InPlaceEditor.tsx',
  'components/AnnotationLayer.tsx',
  'components/useNewCommentDraft.ts',
  'components/PersonMention.tsx',
  'components/views/story/QueryNotebookPanel.tsx',
  'components/views/story/StoryFormatToolbar.tsx',
  'lib/story/use-live-edits.ts',
  'lib/story/use-live-artifact.ts',
  'lib/story/use-versions.ts',
  'lib/story/document-authoring-client.ts',
  'lib/browser-artifact-write.ts',
  'lib/capture/use-comment-capture.ts',
  'components/RemoteMentionPicker.tsx',
];
const SERVER_CALL = /\bfetch\s*\(|new\s+EventSource\s*\(|readAnnotationPages\s*\(/;

describe('the editing and commenting cone', () => {
  it.each(CONE)('%s reaches the server only through ArtifactBackend', (rel) => {
    const source = readFileSync(path.join(APP, rel), 'utf8');
    const offending = source.split('\n').map((line, i) => [i + 1, line] as const).filter(([, line]) => SERVER_CALL.test(line));
    expect(offending).toEqual([]);
  });
});
