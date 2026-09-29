import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { STORY_COMMITTED_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_IMAGE_DROP_MESSAGE, STORY_TYPING_MESSAGE } from '@/lib/story-runtime/contract';
import { createInPlaceEdit } from '../create-in-place-edit';
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
