import { replaceComment } from './comment-input';
/* @jsxImportSource solid-js */
/**
 * THE RAIL AND THE PINS. Open threads
 * float over the document at their anchor y; a pin or an annotated-node click opens that thread in
 * the rail; resolved history sits below the open list. Replies, resolution, deletion, provenance
 * marks and the phone's compact marker all live here. The composer is annotation-composer.test.tsx;
 * picking a block or drawing an area is annotation-picking.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { AnnotationLayer } from '../AnnotationLayer';
import { STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE } from '@/lib/story-runtime/contract';
import { personHue } from '@/lib/islands/person-face';
import { Avatar } from '../../ui/Avatar';
import { fireEvent, render } from '../../__tests__/helpers';
import { AuthorIdentity, positionedComments } from '../AnnotationPreview';
import {
  ADA_IMAGE, ANN, FACES, GENERIC_AGENT, MCP_AGENT, NONCE, fetchCalls, flush, httpBackend, installAnnotationFetch, knobs, layer, makeRuntime, trustedRoot,
} from './annotation-rig';

beforeEach(installAnnotationFetch);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AnnotationLayer', () => {
  it('opens a mention notification on the thread containing its reply', async () => {
    window.history.replaceState(null, '', '/a/example?thread=ann_2');
    try {
      const onRailOpenChange = vi.fn();
      const view = layer({ onRailOpenChange });
      await waitFor(() => expect(onRailOpenChange).toHaveBeenCalledWith(true));
      view.set({ onRailOpenChange, railOpen: true });
      await screen.findByText('one more thought');
      expect(view.container.querySelector('[data-thread-id="ann_1"]')).not.toBeNull();
    } finally { window.history.replaceState(null, '', '/'); }
  });

  it('opens a notification target when navigation changes the query on the same artifact', async () => {
    const open = vi.fn();
    const view = layer({ onRailOpenChange: open });
    await flush(); await flush();
    try {
      window.history.replaceState(null, '', `?thread=${ANN.id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await flush();
      expect(open).toHaveBeenCalledWith(true);
      expect(view.runtime.posts().at(-1).openId).toBe(ANN.id);
    } finally { window.history.replaceState(null, '', window.location.pathname); }
  });

  it('follows a notification link the app router navigates to without reloading the page', async () => {
    const history = createMemoryHistory();
    history.set({ value: '/a/doc1', replace: true });
    const runtime = makeRuntime();
    const open = vi.fn();
    render(() => <MemoryRouter history={history}><Route path="*" component={() => (
      <AnnotationLayer id="doc1" backend={httpBackend('doc1')} runtimeRef={runtime.ref} sessionNonce={NONCE} railOpen={false} onRailOpenChange={open} />
    )} /></MemoryRouter>);
    await flush(); await flush();
    expect(open).not.toHaveBeenCalled();
    history.set({ value: `/a/doc1?comment=${ANN.thread[1]!.id}` });
    await flush();
    expect(open).toHaveBeenCalledWith(true);
    expect(runtime.posts().at(-1).openId).toBe(ANN.id);
  });

  it('shows distinct local times for a comment and reply on the same day', async () => {
    const view = layer({ railOpen: true });
    await screen.findByText('is this right?');
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: ANN.id });
    await screen.findByText('one more thought');
    const times = [...view.container.querySelectorAll('time')];
    const first = times.find((time) => time.dateTime === ANN.thread[0]!.created_at);
    const reply = times.find((time) => time.dateTime === ANN.thread[1]!.created_at);
    expect(first).toBeDefined();
    expect(reply).toBeDefined();
    expect(first!.textContent).not.toBe(reply!.textContent);
    expect(first!.textContent).toContain(new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' }).format(new Date(ANN.thread[0]!.created_at)));
    expect(first!.textContent).toMatch(/\d+:\d{2}/);
    expect(first).toHaveAttribute('aria-label', expect.stringMatching(/2026/));
  });

  it('scrolls the newest reply in its own shadow-root rail', async () => {
    const view = layer({ railOpen: true }, makeRuntime(), { trusted: true });
    await waitFor(() => expect(trustedRoot().querySelector('[data-thread-id="ann_1"]')).not.toBeNull());
    const thread = trustedRoot().querySelector('[data-thread-id="ann_1"]')!;
    const scroll = vi.fn(); thread.scrollIntoView = scroll;
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: ANN.id });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it('subscribes when a lazy inline runtime becomes ready after the layer mounts', async () => {
    const runtime = makeRuntime({ left: 0, top: 0, width: 1000, height: 800 });
    const controller = runtime.ref.current;
    runtime.ref.current = null;
    const view = layer({ sessionNonce: null, showViewComments: true, liveAnnotations: [ANN] }, runtime);
    runtime.ref.current = controller;
    view.set({ sessionNonce: NONCE, showViewComments: true, liveAnnotations: [ANN] });
    runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 20, y: 150, width: 100, height: 30 } }] });
    expect(screen.getByLabelText(/^Open annotation conversation by vivek/)).toBeInTheDocument();
  });

  it('keeps a shadow-root thread menu open for pointer gestures inside that menu', async () => {
    layer({ railOpen: true }, makeRuntime(), { trusted: true });
    await waitFor(() => expect(trustedRoot().querySelector('[aria-label="Annotation actions"]')).not.toBeNull());
    fireEvent.click(trustedRoot().querySelector('[aria-label="Annotation actions"]')!);
    const button = trustedRoot().querySelector('[aria-label="Delete thread"]')!;
    expect(button).not.toBeNull();
    fireEvent.pointerDown(button, { bubbles: true, composed: true });
    expect(button.isConnected).toBe(true);
    expect(trustedRoot().querySelector('[aria-label="Annotation action menu"]')).not.toBeNull();
  });

  it('posts the pin set into the document even in view mode (pins are owner view chrome)', async () => {
    const view = layer();
    await flush();
    const posted = view.runtime.posts();
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.at(-1)).toMatchObject({ mode: 'on', pins: [{ id: 'ann_1', path: '1' }], openId: null });
    expect(JSON.stringify(posted.at(-1))).not.toContain('is this right?');
  });

  it('a pin click opens the rail on that thread and changes no hash', async () => {
    const onRailOpenChange = vi.fn();
    const view = layer({ onRailOpenChange });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    expect(onRailOpenChange).toHaveBeenCalledWith(true);
    expect(window.location.hash).toBe('');
    view.set({ onRailOpenChange, railOpen: true });
    await flush();
    const thread = await screen.findByLabelText('Annotation thread');
    expect(thread.textContent).toContain('is this right?');
    expect(screen.getByLabelText('Resolve annotation')).toBeTruthy();
  });

  it('overlays each open conversation at its anchor y; clicking one opens the rail focused', async () => {
    const onRailOpenChange = vi.fn();
    const view = layer({ showViewComments: true, onRailOpenChange });
    await flush();
    expect(screen.queryByLabelText(/Open annotation conversation/)).toBeNull();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
    const preview = await screen.findByLabelText('Open annotation conversation by vivek, 2 messages');
    const card = preview.closest<HTMLElement>('[data-annotation-id]')!;
    expect(card).toBeTruthy();
    expect(card).toHaveClass('bg-raised');
    expect(card).not.toHaveClass('bg-comment');
    expect(card.style.top).toBe('320px'); // viewport top (100) + anchor y (220)
    expect(card.style.position).toBe('fixed');
    expect(card.style.right).toBe('12px');
    expect(card.style.maxWidth).toBe('calc(100vw - 24px)');
    expect(card.style.width).toBe('44px');
    expect(card.style.height).toBe('36px');
    expect(card.style.borderRadius).toBe('50% 50% 50% 3px');
    const count = card.querySelector<HTMLElement>('[data-thread-count]');
    expect(count?.textContent).toBe('2');
    expect(count).toHaveClass('top-1/2', 'text-fg');
    expect(count?.parentElement).toHaveClass('justify-start', 'pl-[7px]');
    expect(count).not.toHaveClass('rounded-full');
    expect(screen.queryByText('Revenue grew 40%')).toBeNull();
    expect(screen.queryByText('is this right?')).toBeNull();
    expect(screen.queryByLabelText('Reply to annotation')).toBeNull();

    fireEvent.mouseEnter(card);
    expect(card.style.width).toBe('288px');
    expect(card.style.height).toBe('108px');
    expect(card.style.borderRadius).toBe('5px');
    expect(card).toHaveClass('bg-comment-hover');
    expect(screen.getByLabelText('vivek avatar').textContent).toBe('V');
    expect(screen.getByRole('link', { name: 'View @vivek profile' }).getAttribute('href')).toBe('/@vivek');
    expect(screen.getByText('is this right?')).toBeTruthy();
    view.runtime.emit({ type: STORY_ANNOTATION_HOVER_MESSAGE, id: null });
    expect(card.style.width).toBe('288px'); // a queued document leave cannot cancel a UI hover
    expect(screen.queryByText('one more thought')).toBeNull();
    expect(card.textContent).toContain('+1 more');
    expect(screen.getByLabelText('Reply participants: vivek')).toBeTruthy();
    expect(view.runtime.posts().at(-1)).toMatchObject({ hoverId: ANN.id });
    fireEvent.mouseLeave(card);
    expect(card.style.width).toBe('44px');
    expect(view.runtime.posts().at(-1)).toMatchObject({ hoverId: null });

    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 50, width: 300, height: 40 } }] });
    expect(card.style.top).toBe('150px');
    expect(card.isConnected).toBe(true); // a new layout moves the mark, never remounts it

    fireEvent.click(preview);
    expect(onRailOpenChange).toHaveBeenCalledTimes(1);
    expect(onRailOpenChange).toHaveBeenCalledWith(true);
    view.set({ railOpen: true, showViewComments: false, onRailOpenChange });
    await flush();
    expect(screen.getByLabelText('Reply to annotation')).toBeTruthy();
  });

  it('expands replies after sustained hover, cancels a brief hover, and resets on leaving the preview', async () => {
    const onRailOpenChange = vi.fn();
    const view = layer({ showViewComments: true, onRailOpenChange }, makeRuntime(), { trusted: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
    const card = trustedRoot().querySelector('[data-annotation-id]')!;
    fireEvent.mouseEnter(card);
    const more = trustedRoot().querySelector<HTMLButtonElement>('[aria-label="Expand replies"]');
    expect(more).not.toBeNull();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.mouseEnter(more!);
    vi.advanceTimersByTime(400);
    expect(card.textContent).not.toContain('one more thought');
    fireEvent.mouseLeave(more!);
    vi.advanceTimersByTime(600);
    expect(card.textContent).not.toContain('one more thought');
    fireEvent.mouseEnter(more!);
    vi.advanceTimersByTime(600);
    expect(card.textContent).toContain('one more thought');
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(onRailOpenChange).not.toHaveBeenCalled();
    fireEvent.mouseLeave(card);
    fireEvent.mouseEnter(card);
    expect(card.textContent).not.toContain('one more thought');
    fireEvent.click(trustedRoot().querySelector('[aria-label="Expand replies"]')!);
    expect(card.textContent).toContain('one more thought');
  });

  it('the sidebar resolves and replies; resolving drops the pin', async () => {
    const view = layer({ railOpen: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    await screen.findByLabelText('Annotation thread');
    replaceComment(screen.getByLabelText('Reply to annotation'), 'never mind');
    fireEvent.click(screen.getByLabelText('Send reply'));
    await flush();
    const reply = fetchCalls.find((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'POST');
    expect(JSON.parse(String(reply!.init!.body))).toMatchObject({ reply: 'never mind' });
    expect(screen.getByLabelText('Reply to annotation').textContent).toBe('');

    fireEvent.click(screen.getByLabelText('Resolve annotation'));
    await flush();
    const resolveCall = fetchCalls.filter((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'POST').at(-1);
    expect(JSON.parse(String(resolveCall!.init!.body))).toMatchObject({ resolve: true });
    expect(view.runtime.posts().at(-1)).toMatchObject({ pins: [] });
  });

  it('keeps unresolved threads compact until selected, then expands without flex clipping', async () => {
    layer({ railOpen: true });
    await flush();
    const thread = await screen.findByLabelText('Annotation thread');
    expect(thread.className).toContain('shrink-0');
    expect(within(thread).getByLabelText('Resolve annotation').querySelector('.lucide-check')).toBeTruthy();
    expect(within(thread).queryByLabelText('Delete thread')).toBeNull();
    fireEvent.click(within(thread).getByLabelText('Annotation actions'));
    expect(within(thread).getByLabelText('Delete thread').querySelector('.lucide-trash-2')).toBeTruthy();
    expect(screen.getByText('is this right?').className).toContain('line-clamp-2');
    expect(screen.queryByText('one more thought')).toBeNull();
    expect(thread.textContent).toContain('+1 more');
    expect(screen.queryByLabelText('Reply to annotation')).toBeNull();

    fireEvent.click(screen.getByText('is this right?'));
    expect(screen.getByText('is this right?')).toBeTruthy();
    expect(screen.getByText('one more thought').className).not.toContain('line-clamp-2');
    expect(screen.getByLabelText('Reply to annotation')).toBeTruthy();
    expect(screen.getByLabelText('Cancel reply')).toHaveClass('bg-transparent');
    expect(screen.getByLabelText('Send reply')).toHaveClass('bg-accent', 'text-bg');
  });

  it('keeps the reply draft when a live frame replaces the thread row', async () => {
    const view = layer({ railOpen: true });
    await flush();
    fireEvent.click(await screen.findByLabelText('Open annotation thread'));
    replaceComment(screen.getByLabelText('Reply to annotation'), 'half written');
    const field = screen.getByLabelText('Reply to annotation');
    view.set({ railOpen: true, liveAnnotations: [{ ...ANN, thread: [...ANN.thread] }] });
    await flush();
    expect(field.isConnected).toBe(true);
    expect(screen.getByLabelText('Reply to annotation')).toHaveTextContent('half written');
  });

  it('lists resolved threads below a divider, collapsed until clicked; close shuts the rail', async () => {
    const onRailOpenChange = vi.fn();
    layer({ railOpen: true, onRailOpenChange });
    await flush(); await flush();
    expect(fetchCalls.some((c) => c.url.includes('status=resolved'))).toBe(true);
    expect(screen.queryByLabelText('Show resolved annotations')).toBeNull();
    expect(await screen.findByText('resolved')).toBeTruthy();
    const divider = screen.getByRole('separator', { name: 'resolved' });
    expect(divider.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.queryByText(/an older figure/)).toBeNull();
    expect(screen.getByText('please verify the older figure')).toBeTruthy();
    expect(screen.queryByText('verified and corrected')).toBeNull();
    expect(screen.getByLabelText('Reply participants: Codex')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Show resolved conversation'));
    expect(screen.getByText('please verify the older figure')).toBeTruthy();
    expect(screen.getByText('verified and corrected')).toBeTruthy();
    expect(screen.getByText('Codex')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Hide resolved conversation'));
    expect(screen.getByText('please verify the older figure')).toBeTruthy();
    expect(screen.queryByText('verified and corrected')).toBeNull();

    fireEvent.click(screen.getByLabelText('Close comments'));
    expect(onRailOpenChange).toHaveBeenCalledWith(false);
  });

  it('reopens an expanded resolved thread and moves it back to the open list', async () => {
    layer({ railOpen: true });
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    fireEvent.click(screen.getByLabelText('Reopen annotation'));
    await flush();
    const reopen = fetchCalls.find((c) => c.url.endsWith('/annotations/ann_old') && c.init?.method === 'POST');
    expect(JSON.parse(String(reopen!.init!.body))).toEqual({ reopen: true });
    await flush();
    expect(screen.queryByLabelText('Resolved annotation thread')).toBeNull();
    expect(screen.getAllByLabelText('Annotation thread')).toHaveLength(2);
    expect(screen.getByText('please verify the older figure')).toBeTruthy();
  });

  it('mirrors document-node hover onto its card and gives agent replies their brand mark', async () => {
    const view = layer({ railOpen: true });
    await flush();
    await screen.findByLabelText('Annotation thread');
    view.runtime.emit({ type: STORY_ANNOTATION_HOVER_MESSAGE, id: ANN.id });
    expect(screen.getByLabelText('Annotation thread').getAttribute('data-hovered')).toBe('true');
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    expect(screen.getByLabelText('Codex agent')).toBeTruthy();
    expect(screen.getByLabelText('Agent type Codex')).toBeTruthy();
  });

  it('names the agent an MCP reply came from, with its own glyph and the MCP chip', async () => {
    const view = layer({ showViewComments: true });
    await flush();
    view.set({ showViewComments: true, liveAnnotations: [MCP_AGENT] });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: MCP_AGENT.id, rect: { x: 10, y: 100, width: 300, height: 40 } }] });
    const marker = await screen.findByLabelText('Open annotation conversation by Claude Code, 1 message');
    fireEvent.mouseEnter(marker.closest<HTMLElement>('[data-annotation-id]')!);
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByLabelText('Agent type Claude Code')).toBeTruthy();
    const mark = screen.getByLabelText('Claude Code agent');
    expect(mark.querySelector('path')?.getAttribute('d')?.startsWith('M20.998')).toBe(true);
  });

  it('uses the generic agent icon and keeps HTTP provenance when no agent name is known', async () => {
    const view = layer({ showViewComments: true });
    await flush();
    view.set({ showViewComments: true, liveAnnotations: [GENERIC_AGENT] });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: GENERIC_AGENT.id, rect: { x: 10, y: 100, width: 300, height: 40 } }] });
    const marker = await screen.findByLabelText('Open annotation conversation by Agent, 1 message');
    fireEvent.mouseEnter(marker.closest<HTMLElement>('[data-annotation-id]')!);
    expect(screen.getByLabelText('Agent agent')).toBeTruthy();
    expect(screen.getByLabelText('Agent type Agent')).toBeTruthy();
  });

  it('delete asks first, then erases the thread and its pin', async () => {
    const view = layer({ railOpen: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    const thread = await screen.findByLabelText('Annotation thread');
    fireEvent.click(within(thread).getByLabelText('Annotation actions'));
    fireEvent.click(within(thread).getByLabelText('Delete thread'));
    expect(fetchCalls.some((c) => c.init?.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Delete this thread?' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Confirm delete thread'));
    await flush();
    expect(fetchCalls.find((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'DELETE')).toBeTruthy();
    expect(screen.queryByLabelText('Annotation thread')).toBeNull();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pins: [] });
  });

  it('deletes only the chosen reply and keeps the rest of the thread visible', async () => {
    const view = layer({ railOpen: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    const thread = await screen.findByLabelText('Annotation thread');
    const reply = thread.querySelector<HTMLElement>('[data-comment-id="ann_2"]')!;
    fireEvent.click(within(reply).getByLabelText('Comment actions 1'));
    fireEvent.click(within(reply).getByLabelText('Delete comment'));
    expect(screen.getByRole('dialog', { name: 'Delete this comment?' }).textContent).toContain('rest of the thread will stay');
    fireEvent.click(screen.getByLabelText('Confirm delete comment'));
    await flush();
    expect(fetchCalls.find((c) => c.url.endsWith('/annotations/ann_2') && c.init?.method === 'DELETE')).toBeTruthy();
    expect(screen.getByLabelText('Annotation thread')).toBeTruthy();
    expect(screen.getByText('is this right?')).toBeTruthy();
    expect(screen.queryByText('one more thought')).toBeNull();
    expect(view.runtime.posts().at(-1)?.pins).toContainEqual(expect.objectContaining({ id: 'ann_1' }));
  });

  it('keeps a reply and its thread when reply deletion fails', async () => {
    const priorFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => init?.method === 'DELETE'
      ? Promise.resolve(new Response('{}', { status: 500 }))
      : priorFetch(url, init)));
    const view = layer({ railOpen: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    const thread = await screen.findByLabelText('Annotation thread');
    const reply = thread.querySelector<HTMLElement>('[data-comment-id="ann_2"]')!;
    fireEvent.click(within(reply).getByLabelText('Comment actions 1'));
    fireEvent.click(within(reply).getByLabelText('Delete comment'));
    fireEvent.click(screen.getByLabelText('Confirm delete comment'));
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Could not delete this comment');
    expect(screen.getByText('one more thought')).toBeTruthy();
    expect(screen.getByLabelText('Annotation thread')).toBeTruthy();
  });

  it('draws each person as their own face — picture over the initial, colour from the account id — and agents as their marks', async () => {
    knobs.open = [FACES];
    const view = layer({ showViewComments: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: FACES.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
    const preview = await screen.findByLabelText('Open annotation conversation by ada, 4 messages');
    const card = preview.closest<HTMLElement>('[data-annotation-id]')!;
    const compact = card.querySelector<HTMLImageElement>(`img[src="${ADA_IMAGE}"]`);
    expect(compact).not.toBeNull();
    expect(compact!.getAttribute('alt')).toBe('');

    fireEvent.mouseEnter(card);
    const header = within(card).getByLabelText('ada avatar');
    expect(header.querySelector('img')?.getAttribute('src')).toBe(ADA_IMAGE);
    const stack = within(card).getByLabelText('Reply participants: ada, bob, Codex');
    expect(stack.children).toHaveLength(3);
    const [adaMark, bobMark, agentMark] = [...stack.children] as HTMLElement[];
    expect(adaMark!.tagName === 'IMG' ? adaMark!.getAttribute('src') : adaMark!.querySelector('img')?.getAttribute('src')).toBe(ADA_IMAGE);
    expect(bobMark!.querySelector('img')).toBeNull();
    expect(bobMark!.textContent).toBe('B');
    const faceOf = (el: HTMLElement) => ([el, ...el.querySelectorAll<HTMLElement>('*')].find((n) => n.style.backgroundColor)?.style.backgroundColor ?? '');
    const standalone = render(() => <Avatar image={null} initial="bob" userId="usr_bob" size={18} />);
    const expected = faceOf(standalone.container.firstElementChild as HTMLElement);
    expect(expected).not.toBe('');
    expect(faceOf(bobMark!)).toBe(expected);
    const byLabel = render(() => <Avatar image={null} initial="bob" userId="label:bob" size={18} />);
    expect(personHue('usr_bob')).not.toBe(personHue('label:bob'));
    expect(faceOf(bobMark!)).not.toBe(faceOf(byLabel.container.firstElementChild as HTMLElement));
    expect(agentMark!.querySelector('img')).toBeNull();
    expect(agentMark!.querySelector('svg')).not.toBeNull();
  });

  it('on a phone keeps only the compact marker, whose click opens the comments sheet', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    try {
      const onRailOpenChange = vi.fn();
      const view = layer({ showViewComments: true, onRailOpenChange });
      await flush();
      view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
      const marker = await screen.findByLabelText('Open annotation conversation by vivek, 2 messages');
      expect(marker.closest<HTMLElement>('[data-annotation-id]')!.style.width).toBe('44px');
      fireEvent.click(marker);
      expect(onRailOpenChange).toHaveBeenCalledWith(true);
      view.set({ showViewComments: true, onRailOpenChange, railOpen: true });
      await flush();
      const sheet = screen.getByRole('dialog', { name: 'Annotation sidebar' });
      expect(within(sheet).getByLabelText('Close comments')).toBeTruthy();
      expect(within(sheet).getByLabelText('Reply to annotation')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    }
  });

  it('keeps annotations ambient with no visibility-off state', async () => {
    const view = layer({ showViewComments: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
    expect(await screen.findByLabelText(/Open annotation conversation/)).toBeTruthy();
    view.set({ showViewComments: true });
    await flush();
    expect(screen.getByLabelText(/Open annotation conversation/)).toBeTruthy();
    expect(view.runtime.posts().at(-1)).toMatchObject({ mode: 'on' });
  });

  it('the live stream replaces the list wholesale', async () => {
    const view = layer();
    await flush();
    view.set({ liveAnnotations: [] });
    await flush();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pins: [] });
  });

  it('draws the rail into the editor panel that hosts it, and nowhere while that tab is hidden', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    try {
      const view = layer({ railOpen: true, railHost: host });
      await flush();
      expect(within(host).getByLabelText('Annotation sidebar')).toBeTruthy();
      view.set({ railOpen: true, railHost: null });
      await flush();
      expect(screen.queryByLabelText('Annotation sidebar')).toBeNull();
    } finally { host.remove(); }
  });

  it('stacks adjacent floating markers without overlap', () => {
    const second = { ...ANN, id: 'ann_2' };
    const placed = positionedComments([ANN, second], { ann_1: { x: 0, y: 20, width: 10, height: 10 }, ann_2: { x: 0, y: 22, width: 10, height: 10 } }, { top: 40, height: 600 }, 800);
    expect(placed.map((item) => item.top)).toEqual([60, 102]);
  });
});

it('starts replies empty even in a tagged thread and retains a failed reply', async () => {
  const mention = `[@claude](/chat?session=${'a'.repeat(64)})`;
  const tagged = { ...ANN, thread: [{ ...ANN.thread[0]!, body: `${mention} help` }] };
  knobs.open = [tagged];
  const view = layer({ railOpen: true, liveAnnotations: [tagged] });
  await screen.findByText('help', { exact: false });
  view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: ANN.id });
  const field = await screen.findByLabelText('Reply to annotation');
  expect(field.textContent).toBe('');
  expect(screen.getByLabelText('Send reply')).toBeDisabled();
  replaceComment(field, `${mention} how is it going?`);
  fireEvent.click(screen.getByLabelText('Send reply')); await flush();
  expect(field.textContent).toBe('');
  replaceComment(field, 'my draft');
  expect(field).toHaveTextContent('my draft');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
  fireEvent.click(screen.getByLabelText('Send reply'));
  await screen.findByRole('alert');
  expect(field).toHaveTextContent('my draft');
});

it('shows a connected agent program instead of its transport', () => {
  render(() => <AuthorIdentity author={{kind:'agent',label:'koala-8e44ad',sessionId:'a'.repeat(64),harness:'pi',transport:'http',user_id:null,image:null}} />);
  expect(screen.getByLabelText('Agent type Pi')).toBeTruthy();
  expect(screen.getByLabelText('Pi agent').querySelector('svg')).toBeTruthy();
  expect(screen.queryByLabelText('Transport HTTP')).toBeNull();
});

it('does not replace newer online live statuses with an older offline annotation read',async()=>{
 let resolve!: (rows: typeof ANN[])=>void;
 const work={id:'work',sessionId:'agent',artifactId:'doc1',threadId:ANN.id,commentId:ANN.id,name:'afbin',color:'blue' as const,phase:'completed' as const,updatedAt:'now'};
 const offline={...ANN,remote_work:[{...work,connection:'offline' as const}]};
 const online={...ANN,remote_work:[{...work,connection:'online' as const,activity:'working' as const}]};
 const backend={...httpBackend('doc1'),listAnnotations:(status?:string)=>status==='resolved'?Promise.resolve([]):new Promise<typeof ANN[]>(done=>{resolve=done;})};
 const rig=layer({backend,railOpen:true});await flush();rig.set({backend,railOpen:true,liveAnnotations:[online]});await flush();
 expect(screen.getByText('Answered')).toBeTruthy();resolve([offline]);await flush();expect(screen.queryByText('Answered · offline')).toBeNull();expect(screen.getByText('Answered')).toBeTruthy();
});
