import { replaceComment } from './comment-input';
/* @jsxImportSource solid-js */
/**
 * THE COMPOSER — what a new comment
 * carries and what it must drop. The selection's quote travels with an anchor-relative range, and
 * both are discarded the moment the thing they describe changes: a different durable node at the
 * same path, a widened target, a removed id. A caret comment carries no quote and is still a comment.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { fireEvent } from '../../__tests__/helpers';
import { fetchCalls, flush, installAnnotationFetch, knobs, layer } from './annotation-rig';
import { preloadCommentField } from '../LazyCommentField';

beforeEach(() => {
  installAnnotationFetch();
  // JSDOM doesn't implement the pointer fields used by the browser drag path.
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const creates = () => fetchCalls.filter((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
const selects = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
const TEXT = (over: Partial<StoryEditSelection> = {}): StoryEditSelection => ({ kind: 'text', path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [], ...over } as StoryEditSelection);

describe('the annotation composer', () => {
  beforeAll(() => preloadCommentField());
  const online = { id: '11111111-1111-1111-1111-111111111111', name: 'review', online: true, managed: true, exitCode: null, activity: 'listening' };
  const openComposer = () => layer({ initialSelection: TEXT() });

  it('moves the comment box without losing its draft or annotation target', async () => {
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    replaceComment(field, 'keep this draft while moving');
    const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
    const start = { left: dialog.style.left, top: dialog.style.top };
    const handle = within(dialog).getByLabelText('Move comment box');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 350, clientY: 260 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 350, clientY: 260 });
    expect({ left: dialog.style.left, top: dialog.style.top }).not.toEqual(start);
    expect(field).toHaveTextContent('keep this draft while moving');
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ node_id: 'node-1', body: 'keep this draft while moving' });
  });

  it('moves from the keyboard and clamps the box after viewport resize and selection reports', async () => {
    const view = openComposer(); await flush();
    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    try {
      const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
      const handle = within(dialog).getByLabelText('Move comment box');
      const beforeKeyboardMove = { left: dialog.style.left, top: dialog.style.top };
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
      expect({ left: dialog.style.left, top: dialog.style.top }).not.toEqual(beforeKeyboardMove);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 320 });
      fireEvent(window, new Event('resize'));
      fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 220, clientY: 170 });
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 900, clientY: 900 });
      fireEvent.pointerUp(window, { pointerId: 3, clientX: 900, clientY: 900 });
      expect(Number.parseFloat(dialog.style.left)).toBeLessThanOrEqual(420 - Number.parseFloat(dialog.style.width) - 12);
      expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(112);
      const moved = { left: dialog.style.left, top: dialog.style.top };
      view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ rect: { x: 40, y: 80, width: 200, height: 40 } }) });
      expect({ left: dialog.style.left, top: dialog.style.top }).toEqual(moved);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
      fireEvent(window, new Event('resize'));
      expect(Number.parseFloat(dialog.style.left)).toBeLessThanOrEqual(360 - Number.parseFloat(dialog.style.width) - 12);
      expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(112);
    } finally {
      if (width) Object.defineProperty(window, 'innerWidth', width);
      if (height) Object.defineProperty(window, 'innerHeight', height);
      fireEvent(window, new Event('resize'));
    }
  });

  it('only starts dragging from the move handle and releases canceled pointer gestures', async () => {
    openComposer(); await flush();
    const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
    const start = { left: dialog.style.left, top: dialog.style.top };
    const field = screen.getByLabelText('Annotation comment');
    fireEvent.pointerDown(field, { button: 0, pointerId: 2, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 350, clientY: 260 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 350, clientY: 260 });
    fireEvent.pointerDown(screen.getByLabelText('Cancel annotation'), { button: 0, pointerId: 4, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 350, clientY: 260 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 350, clientY: 260 });
    expect({ left: dialog.style.left, top: dialog.style.top }).toEqual(start);

    const handle = screen.getByLabelText('Move comment box');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: setPointerCapture });
    Object.defineProperty(handle, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 5, clientX: 250, clientY: 180 });
    expect(setPointerCapture).toHaveBeenCalledWith(5);
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 300, clientY: 220 });
    const moved = { left: dialog.style.left, top: dialog.style.top };
    fireEvent.pointerCancel(window, { pointerId: 5 });
    expect(releasePointerCapture).toHaveBeenCalledWith(5);
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 400, clientY: 300 });
    expect({ left: dialog.style.left, top: dialog.style.top }).toEqual(moved);
  });

  it.each(['pointerup', 'blur'] as const)('releases pointer capture and stops following moves after %s', async (end) => {
    openComposer(); await flush();
    const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
    const handle = within(dialog).getByLabelText('Move comment box');
    const releasePointerCapture = vi.fn();
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 8, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 280, clientY: 200 });
    const moved = { left: dialog.style.left, top: dialog.style.top };
    if (end === 'pointerup') fireEvent.pointerUp(window, { pointerId: 8 });
    else fireEvent(window, new Event('blur'));
    expect(releasePointerCapture).toHaveBeenCalledWith(8);
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 500, clientY: 500 });
    expect({ left: dialog.style.left, top: dialog.style.top }).toEqual(moved);
  });

  it.each(['close', 'target change'] as const)('ends an active drag when the composer %s', async (reason) => {
    const view = openComposer(); await flush();
    const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
    const handle = within(dialog).getByLabelText('Move comment box');
    const releasePointerCapture = vi.fn();
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 280, clientY: 200 });
    const moved = { left: dialog.style.left, top: dialog.style.top };
    if (reason === 'close') fireEvent.click(screen.getByLabelText('Close annotation composer'));
    else view.set({ initialSelection: TEXT({ nodeId: 'next-target', path: '2' }) });
    await flush();
    expect(releasePointerCapture).toHaveBeenCalledWith(9);
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 500, clientY: 500 });
    if (reason === 'target change') {
      const nextDialog = screen.getByRole('dialog', { name: 'Annotation composer' });
      expect({ left: nextDialog.style.left, top: nextDialog.style.top }).not.toEqual(moved);
    } else {
      expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    }
  });

  it('releases pointer capture and removes listeners when the layer unmounts mid-drag', async () => {
    const view = openComposer(); await flush();
    const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
    const handle = within(dialog).getByLabelText('Move comment box');
    const releasePointerCapture = vi.fn();
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(handle, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 10, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 280, clientY: 200 });
    const moved = { left: dialog.style.left, top: dialog.style.top };
    view.unmount();
    expect(releasePointerCapture).toHaveBeenCalledWith(10);
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 500, clientY: 500 });
    expect({ left: dialog.style.left, top: dialog.style.top }).toEqual(moved);
  });

  it('resets a moved placement for the next annotation target', async () => {
    const view = openComposer(); await flush();
    const dialog = screen.getByRole('dialog', { name: 'Annotation composer' });
    const before = { left: dialog.style.left, top: dialog.style.top };
    const handle = screen.getByLabelText('Move comment box');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 6, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(window, { pointerId: 6, clientX: 350, clientY: 260 });
    fireEvent.pointerUp(window, { pointerId: 6, clientX: 350, clientY: 260 });
    expect(dialog.style.left).not.toBe(before.left);
    const movedLeft = dialog.style.left;
    view.set({ initialSelection: TEXT({ nodeId: 'node-next', path: '2', rect: { x: 0, y: 400, width: 100, height: 40 } }) });
    await flush();
    expect(screen.getByRole('dialog', { name: 'Annotation composer' }).style.left).not.toBe(movedLeft);
  });

  it('starts empty and inserts a chosen agent with its stable target, requiring comment text', async () => {
    knobs.sessions = [online, { ...online, id: 'offline', online: false, managed: false }];
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    expect(field).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Tag review' })); await flush();
    expect(field.querySelector('[data-comment-mention]')).toHaveTextContent('@review');
    expect(screen.getByLabelText('Save annotation')).toBeDisabled();
    replaceComment(field, '[@review](/chat?session=11111111-1111-1111-1111-111111111111) Please update this');
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush();
    expect(JSON.parse(String(creates()[0]?.init?.body)).body).toBe('[@review](/chat?session=11111111-1111-1111-1111-111111111111) Please update this');
  });

  it.each([[], [online, { ...online, id: 'second' }], [{ ...online, online: false }], [{ ...online, activity: 'stopped' }], [{...online,runId:'native-box'}]].map((sessions) => ({ sessions })))('leaves new comments empty without a sole eligible online agent: %j', async ({ sessions }) => {
    knobs.sessions = sessions;
    openComposer(); await flush();
    expect(screen.getByLabelText('Annotation comment')).toHaveTextContent('');
  });

  it.each(['My draft', ''])('preserves an edited draft when sessions arrive late: %j', async (value) => {
    let resolve!: (response: Response) => void;
    const fallback = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url === '/api/remote/sessions' ? new Promise((done) => { resolve = done; }) : fallback(url, init));
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    replaceComment(field, 'My draft');
    replaceComment(field, value);
    resolve(new Response(JSON.stringify({ sessions: [online] }))); await flush();
    expect(field).toHaveTextContent(value);
  });

  it('keeps a removed chosen agent removed for the current composer', async () => {
    knobs.sessions = [online];
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    expect(field).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Tag review' })); await flush();
    expect(field.querySelector('[data-comment-mention]')).toHaveTextContent('@review');
    replaceComment(field, ''); await flush();
    expect(field).toHaveTextContent('');
  });

  it('shows two quick choices and opens the full picker for the remaining agents', async () => {
    knobs.sessions = [online, {...online,id:'second',name:'other'}, {...online,id:'33333333-3333-3333-3333-333333333333',name:'third'}];
    openComposer(); await flush();
    expect(screen.getAllByRole('button', {name:/^Tag /})).toHaveLength(2);
    const agents = screen.getByRole('group', {name:'Tag agent'});
    expect(within(agents).queryByText(/agents available/)).toBeNull();
    expect(within(agents).getByRole('link', {name:'Manage agents'})).toHaveAttribute('href', '/chat');
    fireEvent.click(screen.getByRole('button',{name:'+1 other'})); await flush();
    fireEvent.click(screen.getByRole('button',{name:/^Mention third/})); await flush();
    expect(screen.getByLabelText('Annotation comment').querySelector('[data-comment-mention]')).toHaveTextContent('@third');
  });

  it('offers agent setup without navigating away from the comment draft', async () => {
    knobs.sessions = [];
    openComposer(); await flush();
    const agents = screen.getByRole('group', {name:'Tag agent'});
    expect(within(agents).getByText('No agents available')).toBeTruthy();
    const add = within(agents).getByRole('link', {name:'Add agent'});
    expect(add).toHaveAttribute('href', '/chat');
    expect(add).toHaveAttribute('target', '_blank');
    expect(add).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps the original view context across geometry updates and sends it with the native comment', async () => {
    const viewState = { v: 2 as const, state: { $: { screen: 'checkout' }, 'aBcD:open': false } };
    const view = layer({ railOpen: true, initialSelection: TEXT({ viewState }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ nodeId: 'node-1', rect: { x: 9, y: 10, width: 200, height: 40 } }) });
    replaceComment(await screen.findByLabelText('Annotation comment'), 'Review this view');
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush();
    expect(JSON.parse(String(creates()[0]?.init?.body)).view_state).toEqual(viewState);
  });

  it('forwards the selection quote and its anchor-relative range in the create POST', async () => {
    const range = { v: 1 as const, parts: [{ rel: '0', start: 8, end: 12, text: 'grew' }, { rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] };
    layer({ railOpen: true, initialSelection: TEXT({ quote: 'grew 40% in Q3,', range }) });
    await flush();
    replaceComment(await screen.findByLabelText('Annotation comment'), 'which quarter?');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ node_id: 'node-1', body: 'which quarter?', quote: 'grew 40% in Q3,', range });
  });

  it('keeps the captured words when the document re-reports the SAME node', async () => {
    const quoted = TEXT({ nodeId: 'node-1', quote: 'grew 40% in Q3,', range: { v: 1, parts: [{ rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] } });
    const view = layer({ railOpen: true, initialSelection: quoted });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ nodeId: 'node-1', rect: { x: 5, y: 40, width: 200, height: 40 } }) });
    replaceComment(await screen.findByLabelText('Annotation comment'), 'still about those words');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ quote: quoted.quote, range: quoted.range });
  });

  it('does not inherit a removed target identity into an id-less successor at the same path', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ nodeId: 'old-node', quote: 'old words', range: { v: 1, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] } }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ rect: { x: 5, y: 40, width: 200, height: 40 } }) });
    const composer = await screen.findByLabelText('Annotation comment');
    replaceComment(composer, 'draft survives replacement');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(creates()).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for this change to save');
    expect(composer).toHaveTextContent('draft survives replacement');
  });

  it('drops the old quote and range when the same path reports a different durable node', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ nodeId: 'old-node', quote: 'old words', range: { v: 1, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] } }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ nodeId: 'new-node', rect: { x: 5, y: 40, width: 200, height: 40 } }) });
    replaceComment(await screen.findByLabelText('Annotation comment'), 'draft follows explicit target');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ node_id: 'new-node', body: 'draft follows explicit target' });
  });

  it('drops them when the composer is widened to a DIFFERENT node — they no longer describe it', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ quote: 'grew 40% in Q3,', range: { v: 1, parts: [{ rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] } }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { kind: 'element', path: '0', nodeId: 'node-0', tag: 'section', rect: { x: 0, y: 0, width: 400, height: 90 }, className: '', style: '', ancestors: [] } });
    replaceComment(await screen.findByLabelText('Annotation comment'), 'about the whole section');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ node_id: 'node-0', body: 'about the whole section' });
  });

  it('sends no quote for a selection that has none — a caret comment is still a comment', async () => {
    layer({ railOpen: true, initialSelection: TEXT() });
    await flush();
    replaceComment(await screen.findByLabelText('Annotation comment'), 'no words');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ node_id: 'node-1', body: 'no words' });
  });

  it('a handed-in selection opens an anchored page composer; save moves the comment to the rail', async () => {
    const consumed = vi.fn();
    const view = layer({ railOpen: true, onSelectionConsumed: consumed, initialSelection: { kind: 'element', path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }] } as StoryEditSelection });
    await flush();
    expect(consumed).toHaveBeenCalled();
    const composer = await screen.findByLabelText('Annotation comment');
    const popover = screen.getByRole('dialog', { name: 'Annotation composer' });
    expect(popover).toHaveClass('fixed');
    // Kept clear of the open rail's 320px: 800 - 320 - 12 - 384 = 84, not the 217 the selection alone asks for.
    expect(popover.style.left).toBe('84px');
    expect(Number.parseInt(popover.style.left, 10) + Number.parseInt(popover.style.width, 10)).toBeLessThanOrEqual(800 - 320);
    expect(popover.style.top).toBe('158px'); // viewport top + selection y + selection height + 12px
    expect(within(popover).getByText('Add comment')).toBeTruthy();
    expect(within(popover).getByLabelText('Keyboard shortcut to send comment')).toHaveTextContent('Ctrl+Enterto comment');
    expect(within(screen.getByLabelText('Annotation sidebar')).queryByLabelText('Annotation comment')).toBeNull();
    // The breadcrumb: the ancestor is clickable and asks the DOCUMENT to re-select.
    fireEvent.click(screen.getByLabelText('Select section'));
    expect(selects(view.runtime.send).at(-1)).toMatchObject({ path: '2' });

    replaceComment(composer, 'fresh note');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ node_id: 'node-2-1', body: 'fresh note' });
    expect(selects(view.runtime.send).at(-1)).toMatchObject({ path: null });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(screen.getAllByLabelText('Annotation thread').some((thread) => thread.textContent?.includes('fresh note'))).toBe(true);
  });

  it('submits the composer with command-enter and gives only Comment the filled treatment', async () => {
    layer({ railOpen: true, initialSelection: TEXT({ path: '0', rect: { x: 0, y: 0, width: 100, height: 20 } }) });
    await flush();
    const composer = await screen.findByLabelText('Annotation comment');
    const cancel = screen.getByLabelText('Cancel annotation');
    const comment = screen.getByLabelText('Save annotation');
    expect(cancel).toHaveClass('bg-transparent');
    expect(cancel).not.toHaveClass('border');
    expect(comment).toHaveClass('border-accent', 'bg-accent', 'text-bg');
    replaceComment(composer, 'from the keyboard');
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true });
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ body: 'from the keyboard' });
  });

  it('opens the composer on a text selection handed in from view mode', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ path: '2.1', ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }] }) });
    expect(await screen.findByLabelText('Annotation comment')).toBeTruthy();
    await flush();
    expect(view.runtime.posts().at(-1)).toMatchObject({ mode: 'on', selectedPath: '2.1' });
  });

  it('shows the anchor edit refusal instead of silently swallowing it', async () => {
    knobs.refuseCreate = true;
    layer({ railOpen: true, initialSelection: { kind: 'element', path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] } as StoryEditSelection });
    await flush();
    replaceComment(await screen.findByLabelText('Annotation comment'), 'note');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toContain('Inline style'));
    expect(alert.textContent).toContain('invalid_jsx');
    expect(screen.getByLabelText('Annotation comment')).toBeTruthy();
  });

  it('escape cancels the draft, like the cancel button', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ path: '2.1', ancestors: [{ path: '2', tag: 'section', hint: '' }] }) });
    await flush();
    replaceComment(await screen.findByLabelText('Annotation comment'), 'never mind');
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(selects(view.runtime.send).at(-1)).toMatchObject({ path: null });
    expect(fetchCalls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('creates a relation directly without a source edit or head retry', async () => {
    layer({ railOpen: true, initialSelection: { kind: 'element', path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [{ path: '2', tag: 'section', hint: '' }] } as StoryEditSelection });
    await flush();
    replaceComment(await screen.findByLabelText('Annotation comment'), 'mid-sentence note');
    const before = fetchCalls.length;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush(); await flush();
    const created = fetchCalls.slice(before).find((c) => c.init?.method === 'POST');
    expect(created).toBeTruthy();
    expect(JSON.parse(String(created!.init!.body))).toMatchObject({ node_id: 'node-2-1', body: 'mid-sentence note' });
    expect(String(created!.init!.body)).not.toContain('edit_id');
  });

  it('keeps an unsaved-node draft and asks the user to wait for ordinary autosave', async () => {
    layer({ railOpen: true, initialSelection: TEXT({ path: '2.1', nodeId: undefined }) });
    await flush();
    const composer = await screen.findByLabelText('Annotation comment');
    replaceComment(composer, 'keep this draft');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(creates()).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for this change to save');
    expect(composer).toHaveTextContent('keep this draft');
  });

  it('retries the same failed draft with the same idempotency key', async () => {
    const keys: Array<string | null> = [];
    let fail = true;
    const fallback = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/annotations')) {
        keys.push(new Headers(init.headers).get('Idempotency-Key'));
        if (fail) return Promise.reject(new TypeError('network down'));
      }
      return fallback(url, init);
    });
    layer({ initialSelection: TEXT() });
    await flush();
    replaceComment(screen.getByLabelText('Annotation comment'), 'Retry me');
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Annotation comment')).toHaveTextContent('Retry me');
    fail = false;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});
