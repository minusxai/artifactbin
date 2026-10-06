/* @jsxImportSource solid-js */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route, Router } from '@solidjs/router';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { STORY_COMMIT_MESSAGE, STORY_COMMITTED_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_TEXT_EDIT_MESSAGE } from '@/lib/story-runtime/contract';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { screen, within } from '@testing-library/dom';
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

vi.mock('../SourceEditor', () => ({ default: (props: { value: string; onChange: (text: string) => void; readOnly?: boolean; ariaLabel?: string }) =>
  <textarea aria-label={props.ariaLabel ?? 'Markup source'} value={props.value} readOnly={props.readOnly} on:input={event => props.onChange(event.currentTarget.value)} /> }));

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

function mountEditor(source = SOURCE, backend = fakeBackend()) {
  const runtime = fakeRuntime();
  const art = { id: 'doc12345', version: 3, edit_id: 'edit-3', title: 'A note', theme: null, template: null, colorMode: null, markup: source };
  const view = render(() => <Router><Route path="/" component={() => (
    <InPlaceEditor art={art} backend={backend} runtimeRef={runtime.runtimeRef} sessionNonce={NONCE} />
  )} /></Router>);
  runtime.emit({ type: STORY_EDIT_READY_MESSAGE });
  return { ...runtime, view };
}

const drafts = (sent: Array<Record<string, unknown>>) => sent.filter((m) => m.type === STORY_DOCUMENT_MESSAGE).map((m) => m.source);

it('offers image and Markdown insertion directly in the right panel', () => {
  const { sent, view } = mountEditor();
  const insert = within(view.getByRole('region', { name: 'Insert content' }));
  fireEvent.click(insert.getByRole('button', { name: 'Insert image' }));
  expect(screen.getByRole('dialog', { name: 'Insert image' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(insert.getByRole('button', { name: 'Paste Markdown' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Markdown to insert' }), { target: { value: '## Notes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert Markdown' }));
  expect(sent.at(-1)).toMatchObject({ type: 'mx:paste', kind: 'markdown', value: '## Notes' });
});

it('saves a design-system pick and redraws with its identity and default mode, then can undo it', () => {
  const { sent, view } = mountEditor();
  fireEvent.click(view.getByRole('button', { name: 'Design system' }));
  fireEvent.click(screen.getByRole('button', { name: 'Design system Nocturne' }));
  expect(queued).toEqual([{ theme: 'nocturne' }]);
  expect(sent.filter(m => m.type === STORY_DOCUMENT_MESSAGE).at(-1)).toMatchObject({ theme: 'nocturne', colorMode: 'dark', redraw: true, source: SOURCE });
  fireEvent.click(view.getByRole('button', { name: 'Undo design change' }));
  expect(queued.at(-1)).toEqual({ theme: null });
  expect(sent.filter(m => m.type === STORY_DOCUMENT_MESSAGE).at(-1)).toMatchObject({ theme: null, redraw: true, source: SOURCE });
});

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
  const { emit, sent, view } = mountEditor();
  emit({ type: STORY_TEXT_EDIT_MESSAGE, path: '0', innerHtml: 'Hello world' });
  queued.length = 0;
  sent.length = 0;
  fireEvent.keyDown(view.getByRole('textbox', { name: 'Title' }), { key: 'z', ctrlKey: true });
  // A document undo asks the document to commit its typing first, synchronously; the field's own undo does not.
  expect(sent.filter((m) => m.type === STORY_COMMIT_MESSAGE)).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(queued).toEqual([]);
  expect(view.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
});


it('retries query preview when an intervening edit discards the pending result', async () => {
  const backend = fakeBackend();
  let finish!: (value: null) => void;
  const preview = vi.mocked(backend.previewQueries);
  preview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { emit } = mountEditor('<Helmet><Query name="costs">{`select 1 as spend`}</Query></Helmet><p>Hello there</p>', backend);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  emit({ type: STORY_TEXT_EDIT_MESSAGE, path: '0', innerHtml: 'Updated while loading' });
  finish(null);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(preview.mock.calls[1]![0]).toContain('Updated while loading');
});

it('source typing saves and redraws the same draft before returning to App', async () => {
  const { sent, view } = mountEditor();
  fireEvent.click(view.getByRole('tab', { name: 'Edit the source' }));
  // Code is another editing surface: pausing the document makes it ignore its drafts and lets Done skip restoring the head.
  expect(sent.filter(m => m.type === STORY_EDIT_MODE_MESSAGE && m.on === false)).toEqual([]);
  const field = await view.findByRole('textbox', { name: 'Markup source' });
  const next = '<p>Code draft accepted</p>';
  fireEvent.input(field, { target: { value: next } });
  expect(queued).toEqual([{ source: next }]);
  await vi.waitFor(() => expect(drafts(sent)).toContain(next));
  fireEvent.click(view.getByRole('tab', { name: 'Edit on the page' }));
  expect(drafts(sent).at(-1)).toBe(next);
  expect(queued).toHaveLength(1);
});
