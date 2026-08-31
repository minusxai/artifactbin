/**
 * The page half of annotations — the Google-Docs shape. AnnotationLayer holds
 * the data and the session; the frame only ever gets ids + BODY paths
 * (`mx:annotations`) and answers with pin clicks and — while the layer is on
 * — selections. Open threads float over the document at their anchor y; a
 * preview or annotated-node click opens that thread in the rail. There is no
 * annotate MODE any more: the layer and the editor coexist.
 * Resolved history sits collapsed below the open list; the on-page composer
 * carries the edit toolbar's breadcrumb so a comment can widen to an ancestor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import AnnotationLayer from '../AnnotationLayer';
import {
  STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE,
  STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE,
} from '@/lib/story-runtime/contract';
import type { AnnotationWire } from '@/lib/annotations';

const NONCE = 'n'.repeat(32);

const ANN: AnnotationWire = {
  id: 'ann_1',
  status: 'open',
  anchor: { key: 'a1a2b3', path: '1', spanStart: 10, spanEnd: 40 },
  orphaned: false,
  anchor_version: 2,
  snippet: 'Revenue grew 40%',
  thread: [
    { id: 'ann_1', body: 'is this right?', author: { kind: 'human', label: 'vivek', transport: 'browser' }, created_at: '2026-08-27T00:00:00Z' },
    { id: 'ann_2', body: 'one more thought', author: { kind: 'human', label: 'vivek', transport: 'browser' }, created_at: '2026-08-27T01:00:00Z' },
  ],
  created_at: '2026-08-27T00:00:00Z',
  resolved_at: null,
};

const RESOLVED: AnnotationWire = {
  ...ANN,
  id: 'ann_old',
  status: 'resolved',
  snippet: 'an older figure',
  thread: [
    { id: 'ann_old', body: 'please verify the older figure', author: { kind: 'human', label: null, transport: 'browser' }, created_at: '2026-08-26T00:00:00Z' },
    { id: 'ann_reply', body: 'verified and corrected', author: { kind: 'agent', label: 'Codex', transport: 'mcp' }, created_at: '2026-08-26T01:00:00Z' },
  ],
  resolved_at: '2026-08-26T02:00:00Z',
};

const GENERIC_AGENT: AnnotationWire = {
  ...ANN,
  id: 'ann_agent',
  anchor: { key: 'agent-key', path: '2', spanStart: 50, spanEnd: 80 },
  thread: [
    { id: 'ann_agent', body: 'completed by an unidentified agent', author: { kind: 'agent', label: null, transport: 'http' }, created_at: '2026-08-28T00:00:00Z' },
  ],
};

function makeFrame() {
  const postMessage = vi.fn();
  const contentWindow = { postMessage } as unknown as Window;
  const frame = {
    contentWindow,
    getBoundingClientRect: () => ({ x: 0, y: 100, width: 800, height: 600, top: 100, left: 0, right: 800, bottom: 700 }),
  } as unknown as HTMLIFrameElement;
  return { frame, postMessage, contentWindow };
}

const fromFrame = (contentWindow: Window, data: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: contentWindow as unknown as MessageEventSource }));
  });

const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let refuseCreate = false;
let resolvedVisible = true;

beforeEach(() => {
  fetchCalls.length = 0;
  refuseCreate = false;
  resolvedVisible = true;
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('status=resolved')) {
      return new Response(JSON.stringify({ annotations: resolvedVisible ? [RESOLVED] : [] }), { status: 200 });
    }
    if (u.endsWith('/annotations') && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ annotations: [ANN] }), { status: 200 });
    }
    if (init?.method === 'POST' && u.endsWith(`/annotations/${ANN.id}`)) {
      const body = JSON.parse(String(init.body)) as { resolve?: boolean };
      return new Response(JSON.stringify({ ...ANN, status: body.resolve ? 'resolved' : 'open' }), { status: 200 });
    }
    if (init?.method === 'POST' && u.endsWith(`/annotations/${RESOLVED.id}`)) {
      const body = JSON.parse(String(init.body)) as { reopen?: boolean };
      if (body.reopen) resolvedVisible = false;
      return new Response(JSON.stringify({ ...RESOLVED, status: body.reopen ? 'open' : 'resolved', resolved_at: body.reopen ? null : RESOLVED.resolved_at }), { status: 200 });
    }
    if (init?.method === 'POST') {
      if (refuseCreate) {
        return new Response(JSON.stringify({ error: 'invalid_jsx', details: [{ message: 'Inline style attribute is not allowed' }] }), { status: 400 });
      }
      return new Response(JSON.stringify({ ...ANN, id: 'ann_new', thread: [{ ...ANN.thread[0], body: 'fresh note' }] }), { status: 201 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch);
});

afterEach(() => vi.unstubAllGlobals());

const flush = () => act(async () => { await Promise.resolve(); });

const layer = (frame: HTMLIFrameElement, over: Partial<Parameters<typeof AnnotationLayer>[0]> = {}) => (
  <AnnotationLayer
    id="doc1"
    frameRef={{ current: frame }}
    sessionNonce={NONCE}
    railOpen={false}
    currentEditId="e1"
    liveAnnotations={null}
    showViewComments={false}
    topOffset={100}
    onRailOpenChange={() => {}}
    {...over}
  />
);

describe('AnnotationLayer', () => {
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

  it('a handed-in selection opens an anchored page composer; save moves the comment to the rail', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, {
      railOpen: true, currentEditId: 'e_head',
      initialSelection: {
        kind: 'element' as const, path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
        ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }],
      },
    }));
    await flush();

    const composer = await screen.findByLabelText('Annotation comment');
    const popover = screen.getByRole('dialog', { name: 'Annotation composer' });
    expect(popover).toHaveClass('fixed');
    expect(popover.style.left).toBe('217px'); // frame left + selection right + 12px gap
    expect(popover.style.top).toBe('158px'); // frame top + selection y + selection height + 12px
    expect(within(screen.getByLabelText('Annotation sidebar')).queryByLabelText('Annotation comment')).toBeNull();
    // The breadcrumb: the ancestor is clickable and asks the FRAME to re-select.
    fireEvent.click(screen.getByLabelText('Select section'));
    const selects = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
    expect(selects.at(-1)).toMatchObject({ path: '2' });

    fireEvent.change(composer, { target: { value: 'fresh note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toMatchObject({ path: '2.1', edit_id: 'e_head', body: 'fresh note' });
    const clears = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
    expect(clears.at(-1)).toMatchObject({ path: null });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(screen.getAllByLabelText('Annotation thread').some((thread) => thread.textContent?.includes('fresh note'))).toBe(true);
  });

  it('submits the composer with command-enter and gives only Comment the filled treatment', async () => {
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true, currentEditId: 'e_head',
      initialSelection: { kind: 'text' as const, path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] },
    }));
    await flush();

    const composer = await screen.findByLabelText('Annotation comment');
    const cancel = screen.getByLabelText('Cancel annotation');
    const comment = screen.getByLabelText('Save annotation');
    expect(cancel).toHaveClass('bg-transparent');
    expect(cancel).not.toHaveClass('border');
    expect(comment).toHaveClass('border-accent', 'bg-accent', 'text-bg');

    fireEvent.change(composer, { target: { value: 'from the keyboard' } });
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true });
    await flush();
    const create = fetchCalls.find((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toMatchObject({ body: 'from the keyboard' });
  });

  it('opens the composer on a text selection handed in from view mode', async () => {
    const { frame, postMessage } = makeFrame();
    const initialSelection = {
      kind: 'text' as const, path: '2.1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
      ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }],
    };
    render(layer(frame, { railOpen: true, initialSelection }));
    expect(await screen.findByLabelText('Annotation comment')).toBeTruthy();
    await flush();
    const messages = postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(messages.at(-1)).toMatchObject({ mode: 'on', selectedPath: '2.1' });
  });

  it('shows the anchor edit refusal instead of silently swallowing it', async () => {
    refuseCreate = true;
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true, currentEditId: 'e_head',
      initialSelection: { kind: 'element' as const, path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('invalid_jsx');
    expect(alert.textContent).toContain('Inline style');
    expect(screen.getByLabelText('Annotation comment')).toBeTruthy();
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
    await flush();
    const del = fetchCalls.find((c) => c.url.endsWith('/annotations/ann_1') && c.init?.method === 'DELETE');
    expect(del).toBeTruthy();
    expect(screen.queryByLabelText('Annotation thread')).toBeNull();
    const posted = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(posted.at(-1)).toMatchObject({ pins: [] });
  });

  it('escape cancels the draft, like the cancel button', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text' as const, path: '2.1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
        ancestors: [{ path: '2', tag: 'section', hint: '' }],
      },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'never mind' } });

    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    // …and it clears the document's composing outline, exactly as cancel does.
    const selects = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
    expect(selects.at(-1)).toMatchObject({ path: null });
    expect(fetchCalls.some((c) => c.init?.method === 'POST')).toBe(false);
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

  /*
   * THE INVARIANT. The anchor stamp is a real CAS edit, and the editor answers
   * a 409 by taking the server's document — so a comment on the node someone
   * is typing in must not race the flush that carries their typing. Draining
   * first is the same rule an image paste already lives by.
   */
  it('drains the editor BEFORE it stamps the anchor', async () => {
    const order: string[] = [];
    const { frame, contentWindow } = makeFrame();
    const beforeCreate = vi.fn(async () => {
      await Promise.resolve();
      order.push('drain');
    });
    render(layer(frame, {
      railOpen: true, beforeCreate,
      initialSelection: {
        kind: 'element' as const, path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
        ancestors: [{ path: '2', tag: 'section', hint: '' }],
      },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'mid-sentence note' } });

    const before = fetchCalls.length;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    await flush();

    const created = fetchCalls.slice(before).find((c) => c.init?.method === 'POST');
    expect(created).toBeTruthy();
    order.push('post');
    expect(beforeCreate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['drain', 'post']);
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
