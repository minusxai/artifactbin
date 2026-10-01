/* @jsxImportSource solid-js */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route, Router } from '@solidjs/router';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { STORY_COMMIT_MESSAGE, STORY_COMMITTED_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_TEXT_EDIT_MESSAGE } from '@/lib/story-runtime/contract';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import type { PendingChange } from '../create-live-edits';

/** Every change the editor hands to persistence, in order (the real live-edits core still runs behind it). */
const queued: PendingChange[] = [];
vi.mock('../create-live-edits', async (importOriginal) => {
  const real = await importOriginal<typeof import('../create-live-edits')>();
  return {
    ...real,
    createLiveEdits: (options: Parameters<typeof real.createLiveEdits>[0]) => {
      const live = real.createLiveEdits(options);
      const queue = live.queue;
      live.queue = (change) => { queued.push(change); queue(change); };
      return live;
    },
  };
});

import InPlaceEditor from '../InPlaceEditor';

const NONCE = 'n'.repeat(24);
const SOURCE = '<p>Hello there</p>';

/**
 * The adopted document's runtime (document-endpoint's in-process `runtimeRef` branch). Like the edit
 * session, it answers a commit request once it has committed what was typed (nothing, here).
 */
function fakeRuntime() {
  let onEvent: ((data: unknown) => void) | null = null;
  const sent: Array<Record<string, unknown>> = [];
  const runtime = {
    send: (msg: unknown) => {
      sent.push(msg as Record<string, unknown>);
      if ((msg as { type?: string }).type === STORY_COMMIT_MESSAGE) queueMicrotask(() => onEvent?.({ type: STORY_COMMITTED_MESSAGE, nonce: NONCE }));
    },
    subscribe: (fn: (data: unknown) => void) => { onEvent = fn; return () => { onEvent = null; }; },
    getViewportRect: () => new DOMRect(),
  };
  const runtimeRef: DocumentRuntimeRef = { current: runtime as never };
  return { runtimeRef, sent, emit: (data: Record<string, unknown>) => onEvent?.({ ...data, nonce: NONCE }) };
}

beforeEach(() => {
  queued.length = 0;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

function mountEditor() {
  const runtime = fakeRuntime();
  const backend = fakeBackend();
  const art = { id: 'doc12345', version: 3, edit_id: 'edit-3', title: 'A note', theme: null, template: null, colorMode: null, markup: SOURCE };
  const view = render(() => <Router><Route path="/" component={() => (
    <InPlaceEditor art={art} backend={backend} runtimeRef={runtime.runtimeRef} sessionNonce={NONCE} />
  )} /></Router>);
  runtime.emit({ type: STORY_EDIT_READY_MESSAGE });
  return { ...runtime, view };
}

const drafts = (sent: Array<Record<string, unknown>>) => sent.filter((m) => m.type === STORY_DOCUMENT_MESSAGE).map((m) => m.source);

it('Ctrl-Z after typing restores the source, draws it, and queues it once', async () => {
  const { emit, sent, view } = mountEditor();
  emit({ type: STORY_TEXT_EDIT_MESSAGE, path: '0', innerHtml: 'Hello world' });
  const typed = '<p>Hello world</p>';
  expect(queued).toEqual([{ source: typed }]);
  expect(view.getByRole('button', { name: 'Undo' })).not.toBeDisabled();

  queued.length = 0;
  sent.length = 0;
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  await vi.waitFor(() => expect(queued).toHaveLength(1));
  expect(queued[0]!.source).toBe(SOURCE);
  // What was still being typed is committed before the history moves; then the restored source is drawn.
  expect(sent.map((m) => m.type)).toEqual([STORY_COMMIT_MESSAGE, STORY_DOCUMENT_MESSAGE]);
  expect(drafts(sent)).toEqual([SOURCE]);
  expect(view.getByRole('button', { name: 'Undo' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Redo' })).not.toBeDisabled();

  queued.length = 0;
  sent.length = 0;
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
  await vi.waitFor(() => expect(queued).toHaveLength(1));
  expect(queued[0]!.source).toBe(typed);
  expect(drafts(sent)).toEqual([typed]);
});

it('Ctrl-Z inside a text field is left to the field', async () => {
  const { emit, view } = mountEditor();
  emit({ type: STORY_TEXT_EDIT_MESSAGE, path: '0', innerHtml: 'Hello world' });
  queued.length = 0;
  fireEvent.keyDown(view.getByRole('textbox', { name: 'Title' }), { key: 'z', ctrlKey: true });
  await Promise.resolve();
  expect(queued).toEqual([]);
  expect(view.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
});
