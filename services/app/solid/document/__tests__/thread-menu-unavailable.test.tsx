/* @jsxImportSource solid-js */
/**
 * The thread menu is a lazy chunk. When it cannot be fetched (the local preview restarted while it loaded, a dropped
 * connection), the thread stays on screen with its actions trigger standing in, unavailable, and nothing is thrown.
 */
import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { render } from '../../__tests__/helpers';
import { AnnotationThread } from '../AnnotationThread';
import type { ArtifactBackend } from '@/lib/artifact-backend';
import type { AnnotationWire } from '@/lib/annotations';

vi.mock('../../ui/Menu', () => { throw new TypeError('Failed to fetch dynamically imported module: /bundle/Menu.js'); });

const ANN = { id: 'ann_1', status: 'open', anchor: null, orphaned: false, anchor_version: 1, snippet: 'Revenue', quote: null, range: null, quote_found: null,
  thread: [{ id: 'ann_1', body: 'is this right?', author: { kind: 'human', label: 'You', transport: 'browser', user_id: null, image: null }, created_at: '2026-10-14T00:00:00Z' }],
  created_at: '2026-10-14T00:00:00Z', resolved_at: null } as AnnotationWire;

it('keeps the thread and an unavailable actions trigger when the menu chunk cannot load', async () => {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => { errors.push(event.error); };
  window.addEventListener('error', onError);
  try {
    render(() => <AnnotationThread artifactId="doc1" backend={{ unavailable: () => null } as unknown as ArtifactBackend} a={ANN} canDeleteAny open hovered={false} busy={false}
      folded={false} justOpened={false} isCommentFolded={() => false} onOpen={() => {}} onHover={() => {}} onReply={async () => false}
      onResolve={() => {}} onReopen={() => {}} onDelete={() => {}} onToggleFold={() => {}} onToggleComment={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annotation actions' })).toBeDisabled());
    expect(screen.getByText('is this right?')).toBeTruthy();
    expect(errors).toEqual([]);
  } finally { window.removeEventListener('error', onError); }
});
