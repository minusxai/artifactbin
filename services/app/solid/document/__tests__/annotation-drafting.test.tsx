import { replaceComment } from './comment-input';
/* @jsxImportSource solid-js */
/**
 * WHAT THE VIEWER HAS NOT SENT. A page that reloads itself to follow its source (the local preview) must not
 * do it under an open composer or a typed reply; the layer says when it holds either, and when it no longer does.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import type { StoryEditSelection } from '@/lib/edit-protocol';
import { fireEvent } from '../../__tests__/helpers';
import { flush, installAnnotationFetch, layer } from './annotation-rig';
import { preloadCommentField } from '../LazyCommentField';

beforeEach(installAnnotationFetch);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const TEXT = { kind: 'text', path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] } as unknown as StoryEditSelection;

describe('the layer reports unsent drafts', () => {
  beforeAll(() => preloadCommentField());
  it('is drafting while a composer is open, and stops once it is cancelled', async () => {
    const onDraftingChange = vi.fn();
    layer({ initialSelection: TEXT, onDraftingChange }); await flush();
    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(onDraftingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByLabelText('Close annotation composer')); await flush();
    expect(onDraftingChange).toHaveBeenLastCalledWith(false);
  });
  it('is drafting while an open thread\'s reply holds words, and stops once they are cleared', async () => {
    const onDraftingChange = vi.fn();
    const view = layer({ railOpen: true, onDraftingChange }); await flush();
    view.runtime.emit({ type: 'mx:annotation-pin', id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    await screen.findByLabelText('Annotation thread');
    expect(onDraftingChange).toHaveBeenLastCalledWith(false);
    replaceComment(screen.getByLabelText('Reply to annotation'), 'half a thought'); await flush();
    expect(onDraftingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByLabelText('Cancel reply')); await flush();
    expect(onDraftingChange).toHaveBeenLastCalledWith(false);
  });
});
