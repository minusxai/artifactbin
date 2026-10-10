/* @jsxImportSource solid-js */
/**
 * REPLYING FROM THE HOVER CARD. The expanded ambient preview ends in the thread's own reply box (the
 * sidebar's field and send path, not a second one). Focus or content PINS the card: the mouse leaving
 * or another marker cannot take it away. It closes on its close button, Escape, or a click outside
 * while empty; a draft is never lost — the marker says one is waiting and reopening restores it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import type { AnnotationWire } from '@/lib/annotations/store';
import { STORY_ANNOTATION_LAYOUT_MESSAGE } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { AnnotationPreview } from '../AnnotationPreview';
import { preloadCommentField } from '../LazyCommentField';
import { ANN, flush, httpBackend, installAnnotationFetch, knobs, layer, makeRuntime, trustedRoot } from './annotation-rig';
import { replaceComment } from './comment-input';

const SECOND: AnnotationWire = { ...ANN, id: 'ann_9', anchor: { key: 'k9', path: '2', spanStart: 0, spanEnd: 5 },
  thread: [{ ...ANN.thread[0]!, id: 'ann_9', body: 'a second thread' }] };
const SINGLE: AnnotationWire = { ...ANN, thread: [ANN.thread[0]!] };

beforeAll(() => preloadCommentField());
beforeEach(installAnnotationFetch);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const markerCard = (name: RegExp | string) => screen.getByLabelText(name).closest<HTMLElement>('[data-annotation-id]')!;
const replyField = () => screen.findByRole('textbox', { name: 'Reply to annotation' });

/** Mount the ambient surface, lay the threads out, hover the first marker and expand it. */
async function expandedCard(over: Parameters<typeof layer>[0] = {}, rows: AnnotationWire[] = [ANN]) {
  knobs.open = rows;
  const view = layer({ showViewComments: true, ...over });
  await flush(); await flush();
  view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: rows.map((row, index) => ({ id: row.id, rect: { x: 10, y: 120 + index * 200, width: 300, height: 40 } })) });
  const card = view.container.querySelector<HTMLElement>(`[data-annotation-id="${rows[0]!.id}"]`)!;
  fireEvent.mouseEnter(card);
  fireEvent.click(within(card).getByRole('button', { name: 'Expand replies' }));
  await replyField();
  return { view, card };
}

describe('the expanded hover card ends in a reply box', () => {
  it('only the expanded card has it, pinned to the card bottom as a one-line field that grows on focus', async () => {
    knobs.open = [ANN];
    const view = layer({ showViewComments: true });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 120, width: 300, height: 40 } }] });
    const card = markerCard(/Open annotation conversation by/);
    fireEvent.mouseEnter(card);
    expect(screen.queryByRole('textbox', { name: 'Reply to annotation' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Expand replies' }));
    const field = await replyField();
    const box = field.closest<HTMLElement>('[data-hover-reply]')!;
    expect(box).toHaveClass('sticky', 'order-last');
    expect(box).toHaveAttribute('data-compact', 'true');
    expect(field).toHaveAttribute('aria-placeholder', 'Reply…');
    field.focus();
    fireEvent.focusIn(field);
    expect(box).toHaveAttribute('data-compact', 'false');
  });

  it('comes straight after Resolve in keyboard order', async () => {
    const { card } = await expandedCard();
    const field = await replyField();
    const resolve = within(card).getByRole('button', { name: 'Resolve thread' });
    const expand = within(card).getByRole('button', { name: 'Expand replies' });
    expect(resolve.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(expand.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('a single-comment thread expands to its reply box too', async () => {
    await expandedCard({}, [SINGLE]);
    expect(await replyField()).toBeTruthy();
  });
});

describe('focus or content pins the card', () => {
  it('focus pins it: leaving with the mouse does not close it, and hovering another marker does not replace it', async () => {
    const { view, card } = await expandedCard({}, [ANN, SECOND]);
    const field = await replyField();
    field.focus(); fireEvent.focusIn(field);
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('288px');
    expect(view.runtime.posts().at(-1)).toMatchObject({ hoverId: ANN.id });
    const other = view.container.querySelector<HTMLElement>(`[data-annotation-id="${SECOND.id}"]`)!;
    fireEvent.mouseEnter(other);
    expect(card.style.width).toBe('288px');
    expect(other.style.width).toBe('36px');
    expect(screen.getByRole('textbox', { name: 'Reply to annotation' })).toBe(field);
  });

  it('focus moving from Resolve into the box inside the trusted shadow root still pins it', async () => {
    knobs.open = [ANN];
    const view = layer({ showViewComments: true }, makeRuntime(), { trusted: true });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 120, width: 300, height: 40 } }] });
    const root = trustedRoot();
    const card = root.querySelector<HTMLElement>('[data-annotation-id]')!;
    fireEvent.mouseEnter(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Expand replies' }));
    const field = await within(card).findByRole('textbox', { name: 'Reply to annotation' });
    within(card).getByRole('button', { name: 'Resolve thread' }).focus();
    field.focus();
    expect(root.activeElement).toBe(field);
    expect(within(card).getByRole('button', { name: 'Close comment preview' })).toBeTruthy();
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('288px');
  });

  it('content keeps it pinned after focus leaves and through a click outside', async () => {
    const { card } = await expandedCard();
    const field = await replyField();
    replaceComment(field, 'half a thought');
    fireEvent.mouseLeave(card);
    field.blur(); fireEvent.focusOut(field);
    fireEvent.pointerDown(document.body);
    await flush();
    expect(card.style.width).toBe('288px');
    expect(screen.getByRole('textbox', { name: 'Reply to annotation' })).toHaveTextContent('half a thought');
  });

  it('an empty card closes on a click outside', async () => {
    const { card } = await expandedCard();
    const field = await replyField();
    field.focus(); fireEvent.focusIn(field);
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('288px');
    fireEvent.pointerDown(document.body);
    await flush();
    expect(card.style.width).toBe('44px');
  });

  it('a tap (no hover) opens the card already pinned, without opening the sidebar', async () => {
    knobs.open = [ANN];
    const onRailOpenChange = vi.fn();
    const view = layer({ showViewComments: true, onRailOpenChange });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 120, width: 300, height: 40 } }] });
    const marker = screen.getByLabelText(/Open annotation conversation by/);
    const card = markerCard(/Open annotation conversation by/);
    fireEvent.pointerDown(marker, { pointerType: 'touch' });
    fireEvent.click(marker);
    expect(onRailOpenChange).not.toHaveBeenCalled();
    expect(await replyField()).toBeTruthy();
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('288px');
    expect(within(card).getByRole('button', { name: 'Close comment preview' })).toBeTruthy();
  });
});

describe('closing never loses a draft', () => {
  it('Escape with content closes the card, marks the draft on the marker, and reopening restores it', async () => {
    const { card } = await expandedCard();
    replaceComment(await replyField(), 'keep me');
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(card.style.width).toBe('44px');
    expect(within(card).getByLabelText('Unsent reply draft')).toBeTruthy();
    fireEvent.mouseEnter(card);
    expect(await replyField()).toHaveTextContent('keep me');
  });

  it('Escape on an empty card just closes it', async () => {
    const { card } = await expandedCard();
    const field = await replyField();
    field.focus(); fireEvent.focusIn(field);
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(card.style.width).toBe('44px');
    expect(within(card).queryByLabelText('Unsent reply draft')).toBeNull();
  });

  it('the close button closes a pinned card and keeps its draft', async () => {
    const { card } = await expandedCard();
    replaceComment(await replyField(), 'still mine');
    fireEvent.click(within(card).getByRole('button', { name: 'Close comment preview' }));
    await flush();
    expect(card.style.width).toBe('44px');
    expect(within(card).getByLabelText('Unsent reply draft')).toBeTruthy();
  });
});

describe('sending from the card', () => {
  const replied = (body: string): AnnotationWire => ({ ...ANN, revision: 2, thread: [...ANN.thread, { ...ANN.thread[0]!, id: 'ann_3', body, created_at: '2026-08-27T02:00:00Z' }] });

  it('posts through the thread reply path; the reply appears at once, the box clears, the card stays open', async () => {
    const actOnAnnotation = vi.fn(async (_id: string, body: { reply?: string }) => replied(body.reply ?? ''));
    const { card } = await expandedCard({ backend: { ...httpBackend('doc1'), actOnAnnotation } });
    const field = await replyField();
    replaceComment(field, 'answered from the card');
    fireEvent.click(within(card).getByRole('button', { name: 'Send reply' }));
    await flush(); await flush();
    expect(actOnAnnotation).toHaveBeenCalledWith(ANN.id, { reply: 'answered from the card' });
    expect(within(card).getByRole('list', { name: 'Thread replies' })).toHaveTextContent('answered from the card');
    expect(screen.getByRole('textbox', { name: 'Reply to annotation' })).toHaveTextContent('');
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('288px');
  });

  it('sends with the sidebar shortcut', async () => {
    const actOnAnnotation = vi.fn(async (_id: string, body: { reply?: string }) => replied(body.reply ?? ''));
    await expandedCard({ backend: { ...httpBackend('doc1'), actOnAnnotation } });
    const field = await replyField();
    replaceComment(field, 'by keyboard');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await flush();
    expect(actOnAnnotation).toHaveBeenCalledWith(ANN.id, { reply: 'by keyboard' });
  });

  it('a failed send keeps the draft with an inline error, and the card stays open', async () => {
    const actOnAnnotation = vi.fn(async () => { throw new Error('offline'); });
    const { card } = await expandedCard({ backend: { ...httpBackend('doc1'), actOnAnnotation } });
    replaceComment(await replyField(), 'do not lose this');
    fireEvent.click(within(card).getByRole('button', { name: 'Send reply' }));
    await flush(); await flush();
    expect(within(card).getByRole('alert')).toHaveTextContent('Could not send reply');
    expect(screen.getByRole('textbox', { name: 'Reply to annotation' })).toHaveTextContent('do not lose this');
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('288px');
  });
});

describe('who gets a box', () => {
  it('no reply handler (no permission, or a resolved countdown row) means no box', async () => {
    render(() => <AnnotationPreview row={ANN} top={100} hovered onOpen={() => {}} onHover={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand replies' }));
    await flush();
    expect(screen.queryByRole('textbox', { name: 'Reply to annotation' })).toBeNull();
    expect(screen.queryByLabelText('Send reply')).toBeNull();
  });

  it('a thread resolved elsewhere, still counting down on its marker, gets no box', async () => {
    knobs.open = [ANN];
    const view = layer({ showViewComments: true });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 120, width: 300, height: 40 } }] });
    knobs.resolved = [{ ...ANN, status: 'resolved', revision: 2, resolved_at: '2026-09-23T00:00:00Z' }];
    view.set({ showViewComments: true, liveAnnotations: [] });
    await flush(); await flush();
    expect(screen.getByRole('status')).toHaveTextContent('10 seconds');
    const card = markerCard(/Open annotation conversation by/);
    fireEvent.mouseEnter(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Expand replies' }));
    await flush();
    expect(within(card).getByRole('list', { name: 'Thread replies' })).toHaveTextContent('one more thought');
    expect(screen.queryByRole('textbox', { name: 'Reply to annotation' })).toBeNull();
  });
});
