/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { StoryController } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { AnnotationLayer } from '../AnnotationLayer';
import { createSignal } from 'solid-js';
import { positionedComments } from '../AnnotationPreview';

const thread = { id: 'ann1', status: 'open', snippet: 'Selected passage', thread: [{ id: 'c1', body: 'First comment', author: { label: 'Ana' }, created_at: new Date().toISOString() }] } as AnnotationWire;
const backend = (overrides: Partial<ArtifactBackend> = {}) => ({
  listAnnotations: vi.fn(async () => [thread]), actOnAnnotation: vi.fn(async () => ({ ...thread, status: 'resolved' })),
  createAnnotation: vi.fn(async () => thread), deleteAnnotation: vi.fn(async () => {}), unavailable: vi.fn(() => null),
  remoteSessions: vi.fn(async () => ({ sessions: [] })), members: vi.fn(async () => ({ people: [] })), ...overrides,
}) as unknown as ArtifactBackend;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads open comments and resolves a thread through the backend', async () => {
  const service = backend(); const changed = vi.fn();
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}} onAnnotationsChange={changed} />);
  await waitFor(() => expect(view.getByText('First comment')).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Resolve annotation' }));
  await waitFor(() => expect(service.actOnAnnotation).toHaveBeenCalledWith('ann1', { resolve: true }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith([]));
});

it('keeps a draft when the annotation write fails', async () => {
  const service = backend({ createAnnotation: vi.fn(async () => { throw new Error('stale: retake'); }) });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}}
    initialSelection={{ kind: 'text', path: '0', nodeId: 'node1', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [], quote: 'Selected passage' }} />);
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'My draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('stale: retake'));
  expect(view.getByRole('textbox', { name: 'New comment' })).toHaveValue('My draft');
});

it('posts only pin locations to the document runtime and opens the rail on pin click', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as StoryController;
  const located = { ...thread, orphaned: false, anchor: { path: '0', key: 'anchor-key' } } as AnnotationWire;
  const open = vi.fn();
  render(() => <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async () => [located]) })} railOpen={false} onRailOpenChange={open}
    runtimeRef={{ current: runtime }} sessionNonce="private" showViewComments />);
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', pins: [expect.objectContaining({ id: 'ann1', path: '0', key: 'anchor-key' })] })));
  const message = send.mock.calls.at(-1)![0] as { pins: unknown[] };
  expect(JSON.stringify(message)).not.toContain('First comment');
  receive?.({ type: 'mx:annotation-pin', nonce: 'private', id: 'ann1', rect: { x: 0, y: 0, width: 1, height: 1 } });
  expect(open).toHaveBeenCalledWith(true);
});

it('opens the containing thread for a linked reply and scrolls within its own rail', async () => {
  const linked = { ...thread, thread: [...thread.thread, { ...thread.thread[0], id: 'c2', body: 'Linked reply' }] } as AnnotationWire;
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () { scrolled.push(this); };
  try {
    let link!: (target: string | null) => void;
    const view = render(() => {
      const [target, setTarget] = createSignal<string | null>(null);
      const [railOpen, setRailOpen] = createSignal(false);
      link = setTarget;
      return <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async () => [linked]) })} railOpen={railOpen()} onRailOpenChange={setRailOpen} linkTarget={target()} />;
    });
    link('c2');
    await waitFor(() => expect(view.getByText('Linked reply')).toBeTruthy());
    await waitFor(() => expect(scrolled.some(node => (node as HTMLElement).dataset.commentId === 'c2')).toBe(true));
    expect(view.getByLabelText('Annotation sidebar').querySelector('[data-thread-id="ann1"]')).toBeTruthy();
  } finally { Element.prototype.scrollIntoView = original; }
});

it('opens a one-shot Select pick from the rail and composes on the frame selection', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as StoryController;
  const service = backend();
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" />);
  await waitFor(() => expect(view.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true'));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', pick: 'select' }));
  receive?.({ type: 'mx:selection', nonce: 'private', selection: { kind: 'text', path: '2.1', nodeId: 'node-2-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] } });
  expect(view.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'picked note' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(service.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ path: '2.1', node_id: 'node-2-1', body: 'picked note' }), expect.any(String)));
});

it('places floating annotation markers at their reported document geometry', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 50, top: 40, width: 800, height: 600 }) } as unknown as StoryController;
  const located = { ...thread, anchor: { path: '0', key: 'anchor-key' } } as AnnotationWire;
  const view = render(() => <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async () => [located]) })} railOpen={false} onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" showViewComments />);
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', pins: [expect.objectContaining({ id: 'ann1' })] })));
  receive?.({ type: 'mx:annotation-layout', nonce: 'private', positions: [{ id: 'ann1', rect: { x: 10, y: 20, width: 50, height: 20 }, status: 'exact' }] });
  expect(view.getByRole('button', { name: 'Open annotation conversation by Ana, 1 message' }).closest('[data-annotation-id]')).toHaveStyle({ top: '60px' });
});

it('folds a conversation to its summary and remembers the fold across remounts', async () => {
  const service = backend({ listAnnotations: vi.fn(async () => [{ ...thread, thread: [...thread.thread, { ...thread.thread[0], id: 'c2', body: 'Second reply' }] }]) });
  const first = render(() => <AnnotationLayer id="abc-fold" backend={service} railOpen onRailOpenChange={() => {}}
    pickOnOpen={false} />);
  await waitFor(() => expect(first.getByText('First comment')).toBeTruthy());
  fireEvent.click(first.getByRole('button', { name: 'Collapse thread' }));
  expect(first.queryByText('Second reply')).toBeNull();
  expect(first.getByText('1 reply')).toBeTruthy();
  first.unmount();
  const second = render(() => <AnnotationLayer id="abc-fold" backend={service} railOpen onRailOpenChange={() => {}}
    pickOnOpen={false} />);
  await waitFor(() => expect(second.getByRole('button', { name: 'Expand thread' })).toBeTruthy());
  expect(second.queryByText('Second reply')).toBeNull();
});

it('opens a resolved conversation and sends its pin only while expanded', async () => {
  const send = vi.fn();
  const runtime = { send, subscribe: () => () => {} } as unknown as StoryController;
  const resolved = { ...thread, status: 'resolved', anchor: { path: '0', key: 'k' } } as AnnotationWire;
  const service = backend({ listAnnotations: vi.fn(async (status?: string) => status === 'resolved' ? [resolved] : []) });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" />);
  fireEvent.click(view.getByRole('button', { name: 'Show resolved comments' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Show resolved conversation' })).toBeTruthy());
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ pins: [] });
  fireEvent.click(view.getByRole('button', { name: 'Show resolved conversation' }));
  await waitFor(() => expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ openId: 'ann1', pins: [expect.objectContaining({ id: 'ann1' })] }));
});

it('keeps an expanded thread visible when another viewer resolves it', async () => {
  const send = vi.fn();
  const runtime = { send, subscribe: () => () => {} } as unknown as StoryController;
  const located = { ...thread, anchor: { path: '0', key: 'k' } } as AnnotationWire;
  const resolvedElsewhere = { ...located, status: 'resolved' } as AnnotationWire;
  const service = backend({ listAnnotations: vi.fn(async (status?: string) => status === 'resolved' ? [resolvedElsewhere] : [located]) });
  let changeLive!: (rows: AnnotationWire[]) => void;
  const view = render(() => {
    const [live, setLive] = createSignal<AnnotationWire[]>([located]);
    changeLive = setLive;
    return <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}} pickOnOpen={false}
      runtimeRef={{ current: runtime }} sessionNonce="private" liveAnnotations={live()} />;
  });
  fireEvent.click(view.getByRole('button', { name: 'Open annotation thread' }));
  changeLive([]);
  await waitFor(() => expect(service.listAnnotations).toHaveBeenCalledWith('resolved'));
  await waitFor(() => expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ openId: 'ann1', pins: [expect.objectContaining({ id: 'ann1' })] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Reopen annotation' })).toBeTruthy());
});

it('keeps a resolved marker for ten visible seconds and pauses while hovered', async () => {
  const located = { ...thread, anchor: { path: '0', key: 'k' }, revision: 1 } as AnnotationWire;
  const resolvedElsewhere = { ...located, status: 'resolved', revision: 2 } as AnnotationWire;
  const service = backend({ listAnnotations: vi.fn(async (status?: string) => status === 'resolved' ? [resolvedElsewhere] : [located]) });
  let receive: ((data: unknown) => void) | undefined;
  const runtime = { send: vi.fn(), subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; },
    getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as StoryController;
  let changeLive!: (rows: AnnotationWire[]) => void;
  const view = render(() => {
    const [live, setLive] = createSignal<AnnotationWire[]>([located]);
    changeLive = setLive;
    return <AnnotationLayer id="abc" backend={service} railOpen={false} onRailOpenChange={() => {}} runtimeRef={{ current: runtime }}
      sessionNonce="private" showViewComments liveAnnotations={live()} />;
  });
  receive?.({ type: 'mx:annotation-layout', nonce: 'private', positions: [{ id: 'ann1', rect: { x: 10, y: 220, width: 300, height: 40 } }] });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  changeLive([]);
  await Promise.resolve(); await Promise.resolve();
  expect(view.getByRole('status')).toHaveTextContent('10 seconds');
  const marker = view.getByRole('button', { name: /Open annotation conversation by Ana/ });
  vi.advanceTimersByTime(4000);
  expect(view.getByRole('status')).toHaveTextContent('6 seconds');
  fireEvent.mouseEnter(marker.closest('[data-annotation-id]')!);
  vi.advanceTimersByTime(3000);
  expect(view.getByRole('status')).toHaveTextContent('6 seconds');
  fireEvent.mouseLeave(marker.closest('[data-annotation-id]')!);
  vi.advanceTimersByTime(6100);
  expect(view.queryByRole('button', { name: /Open annotation conversation by Ana/ })).toBeNull();
});

it('shows an orphaned passage only while its resolved conversation is expanded', async () => {
  const gone = { ...thread, status: 'resolved', anchor: null, orphaned: true, quote: 'Original passage', quote_found: false } as AnnotationWire;
  const service = backend({ listAnnotations: vi.fn(async (status?: string) => status === 'resolved' ? [gone] : []) });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}} pickOnOpen={false} />);
  fireEvent.click(view.getByRole('button', { name: 'Show resolved comments' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Show resolved conversation' })).toBeTruthy());
  expect(view.queryByText('Original passage')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Show resolved conversation' }));
  expect(view.getByText('Original passage')).toBeTruthy();
  expect(view.getByText('This passage was removed from the document.')).toBeTruthy();
});

it('shows edited-away words when opened but does not repeat a live passage', async () => {
  const edited = { ...thread, status: 'resolved', anchor: { path: '0', key: 'k' }, quote: 'Older words', quote_found: false } as AnnotationWire;
  const service = backend({ listAnnotations: vi.fn(async (status?: string) => status === 'resolved' ? [edited] : []) });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}} pickOnOpen={false} />);
  fireEvent.click(view.getByRole('button', { name: 'Show resolved comments' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Show resolved conversation' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Show resolved conversation' }));
  expect(view.getByText('Older words')).toBeTruthy();
  expect(view.getByText('These words have since been edited.')).toBeTruthy();
  view.unmount();
  const live = { ...edited, quote_found: true } as AnnotationWire;
  const again = render(() => <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async (status?: string) => status === 'resolved' ? [live] : []) })} railOpen onRailOpenChange={() => {}} pickOnOpen={false} />);
  fireEvent.click(again.getByRole('button', { name: 'Show resolved comments' }));
  await waitFor(() => expect(again.getByRole('button', { name: 'Show resolved conversation' })).toBeTruthy());
  fireEvent.click(again.getByRole('button', { name: 'Show resolved conversation' }));
  expect(again.queryByText('Older words')).toBeNull();
});

it('prefills the linked agent in a reply and preserves the draft after a failed send', async () => {
  const linked = { ...thread, thread: [{ ...thread.thread[0], author: { ...thread.thread[0].author, kind: 'human' }, body: `Ask [@Codex](/chat?session=${'a'.repeat(64)}) to check` }] } as AnnotationWire;
  const service = backend({ listAnnotations: vi.fn(async () => [linked]), actOnAnnotation: vi.fn(async () => { throw new Error('Could not send reply'); }) });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}} pickOnOpen={false} />);
  await waitFor(() => expect(view.getByRole('button', { name: 'Open annotation thread' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Open annotation thread' }));
  const reply = view.getByRole('textbox', { name: 'Reply to annotation ann1' });
  expect(reply).toHaveValue('@Codex ');
  expect(view.getByRole('button', { name: 'Send reply' })).toBeDisabled();
  fireEvent.input(reply, { target: { value: '@Codex Please check' } });
  fireEvent.click(view.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Could not send reply'));
  expect(reply).toHaveValue('@Codex Please check');
});

it('requires a screenshot after an explicit Select pick on a versioned document and permits explicit text-only fallback', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as StoryController;
  const service = backend({ unavailable: vi.fn(() => null) });
  const view = render(() => <AnnotationLayer id="abc" editId="edit-current" backend={service} railOpen onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" />);
  fireEvent.click(view.getByRole('button', { name: 'Select' }));
  receive?.({ type: 'mx:selection', nonce: 'private', selection: { kind: 'text', path: '0', nodeId: 'node1', tag: 'p', rect: { x: 1, y: 2, width: 30, height: 20 }, className: '', style: '', ancestors: [] } });
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'Explicit fallback' } });
  expect(view.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  await waitFor(() => expect(view.getByRole('button', { name: 'Continue without screenshot' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Continue without screenshot' }));
  expect(view.getByRole('button', { name: 'Post comment' })).toBeEnabled();
});

it('subscribes when a lazy document runtime becomes ready after the layer mounts', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as StoryController;
  const runtimeRef = { current: null as StoryController | null };
  let ready!: (nonce: string) => void;
  const opened = vi.fn();
  render(() => { const [nonce, setNonce] = createSignal<string | null>(null); ready = setNonce; return <AnnotationLayer id="abc" backend={backend()} railOpen={false} onRailOpenChange={opened} runtimeRef={runtimeRef} sessionNonce={nonce()} />; });
  runtimeRef.current = runtime; ready('private');
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations' })));
  receive?.({ type: 'mx:annotation-pin', nonce: 'private', id: 'ann1', rect: { x: 0, y: 0, width: 1, height: 1 } });
  expect(opened).toHaveBeenCalledWith(true);
});

it('retries the same failed draft with the same idempotency key', async () => {
  let fail = true;
  const create = vi.fn(async (_body: Record<string, unknown>, _key: string) => { if (fail) throw new Error('temporary'); return thread; });
  const service = backend({ createAnnotation: create });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen={false} onRailOpenChange={() => {}}
    initialSelection={{ kind: 'text', path: '0', nodeId: 'node1', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [] }} />);
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'Retry me' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  fail = false;
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1]?.[1]).toBe(create.mock.calls[0]?.[1]);
});

it('Escape cancels a draft and clears the document selection', () => {
  const send = vi.fn();
  const runtime = { send, subscribe: () => () => {} } as unknown as StoryController;
  const view = render(() => <AnnotationLayer id="abc" backend={backend()} railOpen={false} onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private"
    initialSelection={{ kind: 'text', path: '0', nodeId: 'node1', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [] }} />);
  expect(view.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(view.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  expect(send).toHaveBeenCalledWith({ type: 'mx:select', path: null });
});

it('spaces adjacent floating markers and expands reply context on hover', async () => {
  const second = { ...thread, id: 'ann2', thread: [{ ...thread.thread[0], id: 'c2', body: 'Second thread' }] } as AnnotationWire;
  const placed = positionedComments([thread, second], {
    ann1: { x: 0, y: 20, width: 10, height: 10 }, ann2: { x: 0, y: 22, width: 10, height: 10 },
  }, { top: 40, height: 600 }, 800);
  expect(placed.map(item => item.top)).toEqual([60, 102]);
  const withReply = { ...thread, anchor: { path: '0', key: 'k' }, thread: [thread.thread[0], { ...thread.thread[0], id: 'reply', body: 'More context', author: { ...thread.thread[0].author, label: 'Bob' } }] } as AnnotationWire;
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 0, top: 40, width: 800, height: 600 }) } as unknown as StoryController;
  const view = render(() => <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async () => [withReply]) })} railOpen={false} onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" showViewComments />);
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ pins: [expect.objectContaining({ id: 'ann1' })] })));
  receive?.({ type: 'mx:annotation-layout', nonce: 'private', positions: [{ id: 'ann1', rect: { x: 0, y: 20, width: 10, height: 10 } }] });
  const card = view.getByRole('button', { name: 'Open annotation conversation by Ana, 2 messages' }).closest('[data-annotation-id]')!;
  fireEvent.mouseEnter(card);
  expect(view.getByText('First comment')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Expand replies' }));
  expect(view.getByText('More context')).toBeTruthy();
});
