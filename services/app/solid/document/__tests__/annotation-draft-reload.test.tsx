/* @jsxImportSource solid-js */
/**
 * DRAFTS OUTLIVE A RELOAD. The page reloads itself to load a new build after a deploy (solid/lib/app-build), and a
 * reader may reload it themselves: an unsent comment, a typed reply and a comment being rewritten come back in the
 * reloaded page (solid/lib/draft-store, this tab's session storage) — and, once sent or cancelled, they do not.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import type { StoryEditSelection } from '@/lib/edit-protocol';
import { cleanup, fireEvent } from '../../__tests__/helpers';
import { flush, installAnnotationFetch, layer } from './annotation-rig';
import { preloadCommentField } from '../LazyCommentField';
import { replaceComment } from './comment-input';

beforeAll(() => preloadCommentField());
beforeEach(() => { sessionStorage.clear(); installAnnotationFetch(); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const TEXT = { kind: 'text', path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] } as unknown as StoryEditSelection;

/** The open thread's rail, in a page loaded afresh. */
async function openThread() {
  const view = layer({ railOpen: true }); await flush();
  view.runtime.emit({ type: 'mx:annotation-pin', id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
  await screen.findByLabelText('Annotation thread');
  return view;
}

describe('a reload keeps what the reader has not sent', () => {
  it('a typed reply is back in the thread\'s reply box, and gone once cancelled', async () => {
    await openThread();
    replaceComment(screen.getByLabelText('Reply to annotation'), 'half a thought'); await flush();
    cleanup(); // the page reloads

    const onDraftingChange = vi.fn();
    const again = layer({ railOpen: true, onDraftingChange }); await flush();
    again.runtime.emit({ type: 'mx:annotation-pin', id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    await screen.findByLabelText('Annotation thread');
    expect(screen.getByLabelText('Reply to annotation')).toHaveTextContent('half a thought');
    expect(onDraftingChange, 'the page knows it holds unsent words again').toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByLabelText('Cancel reply')); await flush();
    cleanup();

    await openThread();
    expect(screen.getByLabelText('Reply to annotation')).not.toHaveTextContent('half a thought');
  });

  it('an unsent comment is back in the composer when it opens again, and not after it is closed', async () => {
    layer({ initialSelection: TEXT }); await flush();
    replaceComment(screen.getByLabelText('Annotation comment'), 'the number in this paragraph is wrong'); await flush();
    cleanup();

    layer({ initialSelection: TEXT }); await flush();
    expect(screen.getByLabelText('Annotation comment')).toHaveTextContent('the number in this paragraph is wrong');
    fireEvent.click(screen.getByLabelText('Close annotation composer')); await flush();
    cleanup();

    layer({ initialSelection: TEXT }); await flush();
    expect(screen.getByLabelText('Annotation comment')).not.toHaveTextContent('the number in this paragraph is wrong');
  });

  it('a draft belongs to its document: another document\'s composer starts empty', async () => {
    layer({ initialSelection: TEXT }); await flush();
    replaceComment(screen.getByLabelText('Annotation comment'), 'only about doc1'); await flush();
    cleanup();
    layer({ id: 'doc2', initialSelection: TEXT }); await flush();
    expect(screen.getByLabelText('Annotation comment')).not.toHaveTextContent('only about doc1');
  });
});
