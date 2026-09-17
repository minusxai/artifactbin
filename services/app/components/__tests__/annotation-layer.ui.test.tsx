/**
 * THE RAIL AND THE PINS. Open threads float over the document at their anchor
 * y; a pin or an annotated-node click opens that thread in the rail; resolved
 * history sits collapsed below the open list. Replies, resolution, deletion,
 * provenance marks and the phone's compact marker all live here.
 * The composer is `annotation-composer.ui.test.tsx`; picking a block or
 * drawing an area is `annotation-picking.ui.test.tsx`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { TrustedUi } from '@/components/TrustedUi';
import {
  STORY_ANNOTATIONS_MESSAGE,
  STORY_ANNOTATION_HOVER_MESSAGE,
  STORY_ANNOTATION_LAYOUT_MESSAGE,
  STORY_ANNOTATION_PIN_MESSAGE,
} from '@/lib/story-runtime/contract';
import {
  ANN,
  GENERIC_AGENT,
  MCP_AGENT,
  NONCE,
  fetchCalls,
  flush,
  fromFrame,
  installAnnotationFetch,
  layer,
  makeFrame,
} from '@/test/helpers/annotation-layer';

beforeEach(installAnnotationFetch);
afterEach(() => vi.unstubAllGlobals());

describe('AnnotationLayer', () => {
  it('shows distinct local times for a comment and reply on the same day', async () => {
    const { frame, contentWindow } = makeFrame();
    const view = render(layer(frame, { railOpen: true }));
    await screen.findByText('is this right?');
    fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: ANN.id });
    await screen.findByText('one more thought');
    const times = [...view.container.querySelectorAll('time')];
    const first = times.find((time) => time.dateTime === ANN.thread[0].created_at);
    const reply = times.find((time) => time.dateTime === ANN.thread[1].created_at);
    expect(first).toBeDefined();
    expect(reply).toBeDefined();
    expect(first!.textContent).not.toBe(reply!.textContent);
    expect(first!.textContent).toMatch(/27 Aug.*\d+:\d{2}/);
    expect(first).toHaveAttribute('aria-label', expect.stringMatching(/2026/));
  });

  it('scrolls the newest reply in its own shadow-root rail',async()=>{
    const {frame,contentWindow}=makeFrame();
    const view=render(<TrustedUi overlay>{layer(frame,{railOpen:true})}</TrustedUi>);
    const shadow=view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    await waitFor(()=>expect(shadow.querySelector('[data-thread-id="ann_1"]')).not.toBeNull());
    const thread=shadow.querySelector('[data-thread-id="ann_1"]')!;
    const scroll=vi.fn();thread.scrollIntoView=scroll;
    fromFrame(contentWindow,{type:STORY_ANNOTATION_PIN_MESSAGE,nonce:NONCE,id:ANN.id});
    await waitFor(()=>expect(scroll).toHaveBeenCalled());
  });

  it('subscribes when a lazy inline runtime becomes ready after the layer mounts',async()=>{
    const {frame}=makeFrame();
    const runtimeRef:{current:import('@/lib/story-runtime/InlineStoryRuntime').InlineStoryController|null}={current:null};
    const frameRef={current:frame};
    const view=render(layer(frame,{frameRef,runtimeRef,sessionNonce:null,showViewComments:true,liveAnnotations:[ANN]}));
    const listeners=new Set<(event:unknown)=>void>();
    runtimeRef.current={nonce:NONCE,send:vi.fn(),update:vi.fn(),invalidate:vi.fn(),dispose:vi.fn(),getViewportRect:()=>new DOMRect(0,0,1000,800),subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};}};
    view.rerender(layer(frame,{frameRef,runtimeRef,sessionNonce:NONCE,showViewComments:true,liveAnnotations:[ANN]}));
    await act(async()=>{ for(const listener of listeners)listener({type:STORY_ANNOTATION_LAYOUT_MESSAGE,nonce:NONCE,positions:[{id:ANN.id,rect:{x:20,y:150,width:100,height:30}}]}); });
    expect(screen.getByLabelText(/^Open annotation conversation by vivek/)).toBeInTheDocument();
  });

  it('keeps a shadow-root thread menu open for pointer gestures inside that menu',async()=>{
    const {frame}=makeFrame();
    const view=render(<TrustedUi overlay>{layer(frame,{railOpen:true})}</TrustedUi>);
    const shadow=view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    await waitFor(()=>expect(shadow.querySelector('[aria-label="Annotation actions"]')).not.toBeNull());
    fireEvent.click(shadow.querySelector('[aria-label="Annotation actions"]')!);
    const button=shadow.querySelector('[aria-label="Delete annotation"]')!;
    expect(button).not.toBeNull();
    fireEvent.pointerDown(button,{bubbles:true,composed:true});
    expect(button.isConnected).toBe(true);
    expect(shadow.querySelector('[aria-label="Annotation action menu"]')).not.toBeNull();
  });

  it('posts the pin set into the frame even in view mode (pins are owner view chrome)', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame));
    await flush();
    const posted = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.at(-1)).toMatchObject({ mode: 'on', pins: [{ id: 'ann_1', path: '1' }], openId: null });
  });

  it('a pin click opens the rail on that thread and changes no hash', async () => {
    const { frame, contentWindow } = makeFrame();
    const onRailOpenChange = vi.fn();
    const { rerender } = render(layer(frame, { onRailOpenChange }));
    await flush();
    fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    expect(onRailOpenChange).toHaveBeenCalledWith(true);
    expect(window.location.hash).toBe(''); // the rail is view state, never the URL

    rerender(layer(frame, { onRailOpenChange, railOpen: true }));
    await flush();
    const thread = await screen.findByLabelText('Annotation thread');
    expect(thread.textContent).toContain('is this right?');
    expect(screen.getByLabelText('Resolve annotation')).toBeTruthy(); // focused thread shows its actions
  });

  it('overlays each open conversation at its anchor y; clicking one opens the rail focused', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    const onRailOpenChange = vi.fn();
    const { rerender } = render(layer(frame, { showViewComments: true, onRailOpenChange }));
    await flush();

    expect(screen.queryByLabelText(/Open annotation conversation/)).toBeNull();
    fromFrame(contentWindow, {
      type: STORY_ANNOTATION_LAYOUT_MESSAGE,
      nonce: NONCE,
      positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }],
    });
    const preview = await screen.findByLabelText('Open annotation conversation by vivek, 2 messages');
    const card = preview.closest<HTMLElement>('[data-annotation-id]');
    expect(card).toBeTruthy();
    expect(card).toHaveClass('bg-raised');
    expect(card).not.toHaveClass('bg-comment');
    expect(card!.style.top).toBe('320px'); // frame top (100) + anchor y (220)
    expect(card!.style.position).toBe('fixed');
    expect(card!.style.right).toBe('12px');
    expect(card!.style.maxWidth).toBe('calc(100vw - 24px)');
    expect(card!.style.width).toBe('44px');
    expect(card!.style.height).toBe('36px');
    expect(card!.style.borderRadius).toBe('50% 50% 50% 3px');
    const count = card!.querySelector<HTMLElement>('[data-thread-count]');
    expect(count?.textContent).toBe('2');
    expect(count).toHaveClass('top-1/2', 'text-fg');
    expect(count?.parentElement).toHaveClass('justify-start', 'pl-[7px]');
    expect(count).not.toHaveClass('rounded-full');
    expect(preview).not.toHaveAttribute('data-slot', 'tooltip-trigger'); // the fixed marker needs no extra hint
    expect(screen.queryByText('Revenue grew 40%')).toBeNull(); // the document already supplies the quoted context
    expect(screen.queryByText('is this right?')).toBeNull();
    expect(screen.queryByLabelText('Reply to annotation')).toBeNull();

    fireEvent.mouseEnter(card!);
    await flush();
    expect(card!.style.width).toBe('288px');
    expect(card!.style.height).toBe('108px');
    expect(card!.style.borderRadius).toBe('5px');
    expect(card).toHaveClass('bg-comment-hover');
    expect(screen.getByLabelText('vivek avatar').textContent).toBe('V');
    expect(screen.getByRole('link', { name: 'View @vivek profile' }).getAttribute('href')).toBe('/@vivek');
    expect(screen.getByText('is this right?')).toBeTruthy();
    fromFrame(contentWindow,{type:STORY_ANNOTATION_HOVER_MESSAGE,nonce:NONCE,id:null});
    await flush();
    expect(card!.style.width).toBe('288px'); // queued document leave cannot cancel UI hover
    expect(screen.queryByText('one more thought')).toBeNull();
    expect(card!.textContent).toContain('+1 more');
    expect(screen.getByLabelText('Reply participants: vivek')).toBeTruthy();
    const hoverMessages = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(hoverMessages.at(-1)).toMatchObject({ hoverId: ANN.id });
    fireEvent.mouseLeave(card!);
    await flush();
    expect(card!.style.width).toBe('44px');
    const afterLeave = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(afterLeave.at(-1)).toMatchObject({ hoverId: null });

    fromFrame(contentWindow, {
      type: STORY_ANNOTATION_LAYOUT_MESSAGE,
      nonce: NONCE,
      positions: [{ id: ANN.id, rect: { x: 10, y: 50, width: 300, height: 40 } }],
    });
    expect(card!.style.top).toBe('150px');

    fireEvent.click(preview);
    expect(onRailOpenChange).toHaveBeenCalledTimes(1);
    expect(onRailOpenChange).toHaveBeenCalledWith(true);

    rerender(layer(frame, { railOpen: true, showViewComments: false, onRailOpenChange }));
    await flush();
    expect(screen.getByLabelText('Reply to annotation')).toBeTruthy();
  });

  it('the sidebar resolves and replies; resolving drops the pin', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    await screen.findByLabelText('Annotation thread');

    fireEvent.change(screen.getByLabelText('Reply to annotation'), { target: { value: 'never mind' } });
    fireEvent.click(screen.getByLabelText('Send reply'));
    await flush();
    const reply = fetchCalls.find((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'POST');
    expect(JSON.parse(String(reply!.init!.body))).toMatchObject({ reply: 'never mind' });

    fireEvent.click(screen.getByLabelText('Resolve annotation'));
    await flush();
    const resolveCall = fetchCalls.filter((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'POST').at(-1);
    expect(JSON.parse(String(resolveCall!.init!.body))).toMatchObject({ resolve: true });
    const posted = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(posted.at(-1)).toMatchObject({ pins: [] });
  });

  it('keeps unresolved threads compact until selected, then expands without flex clipping', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();

    const thread = await screen.findByLabelText('Annotation thread');
    expect(thread.className).toContain('shrink-0');
    expect(within(thread).getByLabelText('Resolve annotation').querySelector('.lucide-check')).toBeTruthy();
    expect(within(thread).queryByLabelText('Delete annotation')).toBeNull();
    fireEvent.click(within(thread).getByLabelText('Annotation actions'));
    expect(within(thread).getByLabelText('Delete annotation').querySelector('.lucide-trash-2')).toBeTruthy();
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

  it('lists resolved threads below a divider, collapsed until clicked; close shuts the rail', async () => {
    const { frame } = makeFrame();
    const onRailOpenChange = vi.fn();
    render(layer(frame, { railOpen: true, onRailOpenChange }));
    await flush();

    await flush();
    expect(fetchCalls.some((c) => c.url.includes('status=resolved'))).toBe(true);
    expect(screen.queryByLabelText('Show resolved annotations')).toBeNull();
    expect(await screen.findByText('resolved')).toBeTruthy();
    const resolvedDivider = screen.getByRole('separator', { name: 'resolved' });
    expect(resolvedDivider.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
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
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    await flush();

    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    fireEvent.click(screen.getByLabelText('Reopen annotation'));
    await flush();

    const reopen = fetchCalls.find((c) => c.url.endsWith('/annotations/ann_old') && c.init?.method === 'POST');
    expect(JSON.parse(String(reopen!.init!.body))).toEqual({ reopen: true });
    expect(screen.queryByLabelText('Resolved annotation thread')).toBeNull();
    expect(screen.getAllByLabelText('Annotation thread')).toHaveLength(2);
    expect(screen.getByText('please verify the older figure')).toBeTruthy();
  });

  it('mirrors document-node hover onto its card and gives agent replies their brand mark', async () => {
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();

    fromFrame(contentWindow, { type: STORY_ANNOTATION_HOVER_MESSAGE, nonce: NONCE, id: ANN.id });
    expect(screen.getByLabelText('Annotation thread').getAttribute('data-hovered')).toBe('true');

    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    expect(screen.getByLabelText('Codex agent')).toBeTruthy();
    expect(screen.getByLabelText('Transport MCP')).toBeTruthy();
  });

  it('names the agent an MCP reply came from, with its own glyph and the MCP chip', async () => {
    // The byline the /mcp route reads back off the token: a named harness must
    // reach the rail as ITS name and ITS mark, never the anonymous 'Agent'.
    const { frame, contentWindow } = makeFrame();
    const { rerender } = render(layer(frame, { showViewComments: true }));
    await flush();
    rerender(layer(frame, { showViewComments: true, liveAnnotations: [MCP_AGENT] }));
    await flush();
    fromFrame(contentWindow, {
      type: STORY_ANNOTATION_LAYOUT_MESSAGE,
      nonce: NONCE,
      positions: [{ id: MCP_AGENT.id, rect: { x: 10, y: 100, width: 300, height: 40 } }],
    });

    const marker = await screen.findByLabelText('Open annotation conversation by Claude Code, 1 message');
    fireEvent.mouseEnter(marker.closest<HTMLElement>('[data-annotation-id]')!);
    await flush();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByLabelText('Transport MCP')).toBeTruthy();
    // The GLYPH, not just the name: the Claude Code pixel mark's own path.
    const mark = screen.getByLabelText('Claude Code agent');
    expect(mark.querySelector('path')?.getAttribute('d')?.startsWith('M20.998')).toBe(true);
  });

  it('uses the generic agent icon and keeps HTTP provenance when no agent name is known', async () => {
    const { frame, contentWindow } = makeFrame();
    const { rerender } = render(layer(frame, { showViewComments: true }));
    await flush();
    rerender(layer(frame, { showViewComments: true, liveAnnotations: [GENERIC_AGENT] }));
    await flush();
    fromFrame(contentWindow, {
      type: STORY_ANNOTATION_LAYOUT_MESSAGE,
      nonce: NONCE,
      positions: [{ id: GENERIC_AGENT.id, rect: { x: 10, y: 100, width: 300, height: 40 } }],
    });

    const marker = await screen.findByLabelText('Open annotation conversation by Agent, 1 message');
    fireEvent.mouseEnter(marker.closest<HTMLElement>('[data-annotation-id]')!);
    await flush();
    expect(screen.getByLabelText('Agent agent')).toBeTruthy();
    expect(screen.getByLabelText('Transport HTTP')).toBeTruthy();
  });

  it('delete erases the thread and its pin', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: 'ann_1', rect: { x: 10, y: 20, width: 300, height: 50 } });
    await screen.findByLabelText('Annotation thread');

    const thread = screen.getByLabelText('Annotation thread');
    fireEvent.click(within(thread).getByLabelText('Annotation actions'));
    fireEvent.click(within(thread).getByLabelText('Delete annotation'));
    expect(fetchCalls.some(c => c.init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByLabelText('Confirm delete comment'));
    await flush();
    const del = fetchCalls.find((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'DELETE');
    expect(del).toBeTruthy();
    expect(screen.queryByLabelText('Annotation thread')).toBeNull();
    const posted = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(posted.at(-1)).toMatchObject({ pins: [] });
  });

  it('on a phone keeps only the compact marker, whose click opens the comments sheet', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    try {
      const { frame, contentWindow } = makeFrame();
      const onRailOpenChange = vi.fn();
      render(layer(frame, { showViewComments: true, onRailOpenChange }));
      await flush();
      fromFrame(contentWindow, {
        type: STORY_ANNOTATION_LAYOUT_MESSAGE, nonce: NONCE,
        positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }],
      });
      await flush();
      const marker = await screen.findByLabelText('Open annotation conversation by vivek, 2 messages');
      expect(marker.closest<HTMLElement>('[data-annotation-id]')!.style.width).toBe('44px');
      fireEvent.click(marker);
      expect(onRailOpenChange).toHaveBeenCalledWith(true);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    }
  });

  it('keeps annotations ambient with no visibility-off state', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    const { rerender } = render(layer(frame, { showViewComments: true }));
    await flush();
    fromFrame(contentWindow, {
      type: STORY_ANNOTATION_LAYOUT_MESSAGE, nonce: NONCE,
      positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }],
    });
    expect(await screen.findByLabelText(/Open annotation conversation/)).toBeTruthy();

    rerender(layer(frame, { showViewComments: true }));
    await flush();
    expect(screen.getByLabelText(/Open annotation conversation/)).toBeTruthy();
    const posted = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(posted.at(-1)).toMatchObject({ mode: 'on' });
  });

  it('the live stream replaces the list wholesale', async () => {
    const { frame, postMessage } = makeFrame();
    const { rerender } = render(layer(frame));
    await flush();
    rerender(layer(frame, { liveAnnotations: [] }));
    await flush();
    const posted = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(posted.at(-1)).toMatchObject({ pins: [] });
  });
});
