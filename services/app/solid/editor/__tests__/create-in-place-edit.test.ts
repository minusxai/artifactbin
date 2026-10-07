import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { createSignal } from 'solid-js';
import { STORY_COMMENT_KEY_MESSAGE, STORY_EDIT_FLUSH_MESSAGE, STORY_FLOW_EDIT_MESSAGE, STORY_COMMITTED_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_IMAGE_DROP_MESSAGE, STORY_LAYOUT_EDIT_MESSAGE, STORY_OPEN_SCRIPT_MESSAGE, STORY_TYPING_MESSAGE } from '@/lib/story-runtime/contract';
import { createInPlaceEdit } from '../create-in-place-edit';
import { createEditorSource } from '../create-editor-source';
import { renderHook } from '@/solid/__tests__/helpers';

const NONCE = 'n'.repeat(24);

/** The in-process StoryController path (document-endpoint's `runtimeRef` branch) — no real iframe needed. */
function fakeRuntime() {
  let onEvent: ((data: unknown) => void) | null = null;
  const sent: Array<Record<string, unknown>> = [];
  const runtime = {
    send: (msg: unknown) => sent.push(msg as Record<string, unknown>),
    subscribe: (fn: (data: unknown) => void) => { onEvent = fn; return () => { onEvent = null; }; },
    getViewportRect: () => new DOMRect(),
  };
  const runtimeRef: DocumentRuntimeRef = { current: runtime as never };
  return {
    runtimeRef,
    sent,
    emit: (data: Record<string, unknown>) => onEvent?.({ ...data, nonce: NONCE }),
    /** Bypasses the session-nonce stamp — for the trust-boundary case. */
    emitUnsigned: (data: Record<string, unknown>) => onEvent?.(data),
  };
}

afterEach(() => vi.useRealTimers());

it('ignores a frame message without the session nonce, including a forged edit-ready', () => {
  const { runtimeRef, emitUnsigned } = fakeRuntime();
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  expect(edit.ready()).toBe(false);
  emitUnsigned({ type: STORY_EDIT_READY_MESSAGE });
  expect(edit.ready()).toBe(false);
});

it('reaches edit-ready and reports typing state through isUserEditing', () => {
  const { runtimeRef, emit } = fakeRuntime();
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  expect(edit.ready()).toBe(false);
  emit({ type: STORY_EDIT_READY_MESSAGE });
  expect(edit.ready()).toBe(true);

  expect(edit.isUserEditing()).toBe(false);
  emit({ type: STORY_TYPING_MESSAGE, active: true });
  expect(edit.isUserEditing()).toBe(true);
  emit({ type: STORY_TYPING_MESSAGE, active: false });
  expect(edit.isUserEditing()).toBe(false);
});

it('strict navigation commit rejects on timeout instead of permitting draft loss', async () => {
  vi.useFakeTimers();
  const { runtimeRef } = fakeRuntime();
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  const result = edit.commitPending(true).then(() => 'allowed', () => 'blocked');
  await vi.advanceTimersByTimeAsync(1200);
  expect(await result).toBe('blocked');
});

it('simultaneous callers share one acknowledged commit', async () => {
  const { runtimeRef, emit } = fakeRuntime();
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  let ordinary = false, strict = false;
  const first = edit.commitPending().then(() => { ordinary = true; });
  const second = edit.commitPending(true).then(() => { strict = true; });
  emit({ type: STORY_COMMITTED_MESSAGE });
  await Promise.all([first, second]);
  expect(ordinary).toBe(true);
  expect(strict).toBe(true);
});

it('drains a pending commit before inserting a dropped image, and reports the replace target', async () => {
  const { runtimeRef, emit } = fakeRuntime();
  const dropped: Array<[File, unknown]> = [];
  renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
    onImageDrop: (file, where) => dropped.push([file, where]),
  }));
  const file = new File(['x'], 'x.png', { type: 'image/png' });
  emit({ type: STORY_IMAGE_DROP_MESSAGE, file, target: 'body.2' });
  // documentReady() is true (runtimeRef.current set), so commitPending posts a commit and awaits it.
  emit({ type: STORY_COMMITTED_MESSAGE });
  await vi.waitFor(() => expect(dropped).toHaveLength(1));
  expect(dropped[0]![1]).toEqual({ replace: 'body.2' });
});

it('redraws the draft after a grid layout edit so the compiled tiles follow the overlay', () => {
  const { runtimeRef, emit } = fakeRuntime();
  const source = '<Grid><GridItem x={0} y={0} w={6} h={3}><p>Left</p></GridItem></Grid>';
  const edited: Array<[string, boolean | undefined]> = [];
  renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: source }, editing: true, sessionNonce: NONCE,
    onSourceEdited: (next, render) => { edited.push([next, render]); },
  }));
  emit({ type: STORY_LAYOUT_EDIT_MESSAGE, rects: [{ path: '0.0', x: 0, y: 0, w: 4, h: 3 }] });
  expect(edited).toHaveLength(1);
  expect(edited[0]![0]).toContain('w={4}');
  expect(edited[0]![1]).toBe(true);
});

const editModes = (sent: Array<Record<string, unknown>>) => sent.filter((m) => m.type === STORY_EDIT_MODE_MESSAGE).map((m) => m.on);

it('asks for edit mode once on entry and waits for edit-ready instead of polling', async () => {
  vi.useFakeTimers();
  const { runtimeRef, sent, emit } = fakeRuntime();
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(editModes(sent)).toEqual([true]);
  emit({ type: STORY_EDIT_READY_MESSAGE });
  expect(edit.ready()).toBe(true);
});

it('never ends the session itself: unmounting sends no edit-mode off (the edit lifecycle sends the one)', () => {
  const { runtimeRef, sent } = fakeRuntime();
  const { cleanup } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  cleanup();
  expect(editModes(sent)).toEqual([true]);
});

it('pauses for a version preview and resumes after it', () => {
  const { runtimeRef, sent } = fakeRuntime();
  const [editing, setEditing] = createSignal(true);
  renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, get editing() { return editing(); }, sessionNonce: NONCE, onSourceEdited: () => {},
  }));
  setEditing(false);
  setEditing(true);
  expect(editModes(sent)).toEqual([true, false, true]);
});

it('carries typed prose into the source as typing, so its draft waits for a pause; a command is drawn at once', () => {
  const { runtimeRef, emit } = fakeRuntime();
  const drawn: Array<{ source: string; typing: boolean }> = [];
  const { result: store } = renderHook(() => createEditorSource({
    initial: '<p id="a">alpha</p>', live: { queue: () => {} }, commitPending: async () => {},
    draw: (source, _editId, how) => drawn.push({ source, typing: !!how?.typing }),
  }));
  renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { get current() { return store.current(); } }, editing: true, sessionNonce: NONCE,
    onSourceEdited: (next, render, group, selection) => store.apply(next, { origin: 'local', group, selection, redraw: render }),
  }));
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected: '<p id="a">alpha</p>', replacement: '<p id="a">alpha!</p>', group: 'typing:0' });
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected: '<p id="a">alpha!</p>', replacement: '<p id="a"><strong>alpha!</strong></p>' });
  expect(store.current()).toBe('<p id="a"><strong>alpha!</strong></p>');
  expect(drawn).toEqual([
    { source: '<p id="a">alpha!</p>', typing: true },
    { source: '<p id="a"><strong>alpha!</strong></p>', typing: false },
  ]);
});

it('takes the keys a framed document forwards: a signed flush and comment shortcut reach their handlers, unsigned ones do not', () => {
  const { runtimeRef, emit, emitUnsigned } = fakeRuntime();
  const onFlush = vi.fn();
  const onCommentKey = vi.fn();
  const onHistory = vi.fn();
  renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {},
    onFlush, onCommentKey, onHistory,
  }));
  emitUnsigned({ type: STORY_EDIT_FLUSH_MESSAGE, reason: 'enter' });
  emitUnsigned({ type: STORY_COMMENT_KEY_MESSAGE });
  expect(onFlush).not.toHaveBeenCalled();
  expect(onCommentKey).not.toHaveBeenCalled();
  emit({ type: STORY_EDIT_FLUSH_MESSAGE, reason: 'enter' });
  emit({ type: STORY_EDIT_FLUSH_MESSAGE, reason: 'focusout' });
  emit({ type: STORY_COMMENT_KEY_MESSAGE });
  emit({ type: 'mx:history', direction: 'undo' });
  expect(onFlush).toHaveBeenCalledTimes(2);
  expect(onCommentKey).toHaveBeenCalledTimes(1);
  expect(onHistory).toHaveBeenCalledWith('undo');
});

it('opens the script for a mount badge only on a message carrying the session nonce', () => {
  const { runtimeRef, emit, emitUnsigned } = fakeRuntime();
  const onOpenScript = vi.fn();
  renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p>draft</p>' }, editing: true, sessionNonce: NONCE, onSourceEdited: () => {}, onOpenScript,
  }));
  emitUnsigned({ type: STORY_OPEN_SCRIPT_MESSAGE, component: 'Forged' });
  expect(onOpenScript).not.toHaveBeenCalled();
  emit({ type: STORY_OPEN_SCRIPT_MESSAGE, component: 'Sparkline' });
  expect(onOpenScript).toHaveBeenCalledWith('Sparkline');
});


it('pauses a rejected prose session and preserves its first fragment until explicitly restored', async () => {
  const { runtimeRef, emit, sent } = fakeRuntime();
  const onSourceEdited = vi.fn(), onRejectedEdit = vi.fn();
  const sourceRef = { current: '<p id="a">Changed elsewhere</p>' };
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef, editing: true, sessionNonce: NONCE, onSourceEdited, onRejectedEdit,
  }));
  emit({ type: STORY_EDIT_READY_MESSAGE });
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected: '<p id="a">Old</p>', replacement: '<p id="a">My draft</p>' });
  expect(editModes(sent)).toEqual([true, false]);
  expect(edit.ready()).toBe(false);
  expect(edit.isUserEditing()).toBe(true);
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected: sourceRef.current, replacement: '<p id="a">Queued stale write</p>' });
  edit.applyFormat('0', { className: 'font-bold' });
  expect(onSourceEdited).not.toHaveBeenCalled();
  expect(onRejectedEdit.mock.calls).toEqual([['<p id="a">My draft</p>']]);
  await expect(edit.commitPending(true)).rejects.toThrow('Recover the uncommitted text');
  edit.discardRejectedEdit();
  expect(editModes(sent)).toEqual([true, false, true]);
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected: sourceRef.current, replacement: '<p id="a">Changed elsewhere and restored</p>' });
  expect(onSourceEdited).toHaveBeenCalledOnce();
});


it('blocks an in-flight navigation commit when its flush rejects a stale prose edit', async () => {
  const { runtimeRef, emit } = fakeRuntime();
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef: { current: '<p id="a">Updated</p>' }, editing: true,
    sessionNonce: NONCE, onSourceEdited: vi.fn(),
  }));
  const pending = edit.commitPending(true);
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected: '<p id="a">Old</p>', replacement: '<p id="a">Draft</p>' });
  emit({ type: STORY_COMMITTED_MESSAGE });
  await expect(pending).rejects.toThrow('Recover the uncommitted text');
});


it('accepts a full-region Markdown edit over disjoint remote prose without entering draft recovery', async () => {
  const { runtimeRef, emit, sent } = fakeRuntime();
  const expected = '<article id="doc"><p id="a">alpha</p><p id="b">bravo</p></article>';
  const sourceRef = { current: expected.replace('bravo', 'remote words') };
  const edited = vi.fn((next: string) => { sourceRef.current = next; });
  const { result: edit } = renderHook(() => createInPlaceEdit({
    runtimeRef, sourceRef, editing: true, sessionNonce: NONCE, onSourceEdited: edited,
  }));
  emit({ type: STORY_EDIT_READY_MESSAGE });
  emit({ type: STORY_FLOW_EDIT_MESSAGE, path: '0', expected, replacement: expected.replace('<p id="a">alpha</p>', '<h2 id="a">alpha</h2>') });
  expect(edited).toHaveBeenCalledTimes(1);
  expect(sourceRef.current).toBe('<article id="doc"><h2 id="a">alpha</h2><p id="b">remote words</p></article>');
  expect(edit.ready()).toBe(true);
  expect(editModes(sent)).not.toContain(false);
  const committed = edit.commitPending(true);
  emit({ type: STORY_COMMITTED_MESSAGE });
  await expect(committed).resolves.toBeUndefined();
});
