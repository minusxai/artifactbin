/* @jsxImportSource solid-js */
// Losing comment access puts away the composer. Its unsent words still belong to the reader's tab.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import type { StoryEditSelection } from '@/lib/html-runtime/bridge/selection-contract';
import { flush, installAnnotationFetch, layer } from './annotation-rig';
import { preloadCommentField } from '../LazyCommentField';
import { replaceComment } from './comment-input';

beforeAll(() => preloadCommentField());
beforeEach(() => { sessionStorage.clear(); installAnnotationFetch(); });
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TEXT: StoryEditSelection = {
  kind: 'text', path: '1', nodeId: 'node-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 },
  className: '', style: '', ancestors: [],
};

it('puts away the composer when permission is revoked and keeps the words for the next selection', async () => {
  const view = layer({ initialSelection: TEXT });
  replaceComment(await screen.findByRole('textbox', { name: 'Annotation comment' }), 'half a thought');
  view.set({ canCreateComment: false });
  expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();

  view.set({ canCreateComment: true });
  expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  view.set({ canCreateComment: true, initialSelection: TEXT });
  await flush();
  expect(screen.getByRole('textbox', { name: 'Annotation comment' })).toHaveTextContent('half a thought');
});
