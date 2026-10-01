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
  'solid/editor/ArtifactEditor.tsx',
  'solid/editor/InPlaceEditor.tsx',
  'solid/editor/create-in-place-edit.ts',
  'solid/editor/create-live-artifact.ts',
  'solid/editor/create-versions.ts',
  'solid/editor/panels/QueryNotebookPanel.tsx',
  'solid/editor/StoryFormatToolbar.tsx',
  'solid/lib/live-edits-core.ts',
  'solid/document/AnnotationLayer.tsx',
  'solid/document/AnnotationThread.tsx',
  'solid/document/PersonMention.tsx',
  'solid/document/CommentCapture.ts',
  'solid/document/CommentMentionPicker.tsx',
  'lib/story/document/document-authoring-client.ts',
  'lib/browser-artifact-write.ts',
]
const SERVER_CALL = /\bfetch\s*\(|new\s+EventSource\s*\(|readAnnotationPages\s*\(/;

describe('the editing and commenting cone', () => {
  it.each(CONE)('%s reaches the server only through ArtifactBackend', (rel) => {
    const source = readFileSync(path.join(APP, rel), 'utf8');
    const offending = source.split('\n').map((line, i) => [i + 1, line] as const).filter(([, line]) => SERVER_CALL.test(line));
    expect(offending).toEqual([]);
  });
});
