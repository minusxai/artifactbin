/* @jsxImportSource solid-js */
/**
 * EDITING YOUR OWN COMMENT in the rail: the thread menu offers Edit on the comments this viewer wrote and
 * nowhere else; the words become the comment editor in place; Save rewrites them (PATCH, against the thread
 * revision) and the comment then says "edited"; Escape or Cancel puts the words back untouched; a conflict keeps
 * the draft and says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { fireEvent } from '../../__tests__/helpers';
import { SessionProvider } from '../../lib/session';
import { preloadCommentField } from '../LazyCommentField';
import { ANN, RESOLVED, fetchCalls, flush, installAnnotationFetch, knobs, layer, showResolved } from './annotation-rig';
import { replaceComment } from './comment-input';

const THREAD = { ...ANN, revision: 3 };
let patchAnswer: (body: { body: string; expected_revision?: number }) => Response;

beforeEach(async () => {
  installAnnotationFetch();
  knobs.open = [THREAD];
  patchAnswer = (body) => new Response(JSON.stringify({
    ...THREAD, revision: 4, thread: [{ ...THREAD.thread[0]!, body: body.body, edited_at: '2026-10-14T10:00:00Z' }, THREAD.thread[1]!],
  }), { status: 200 });
  const rig = globalThis.fetch;
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    if (String(url) === '/api/page/session') {
      return new Response(JSON.stringify({ user: { id: 'usr_vivek', email: null, username: 'vivek', image: null }, kind: 'account', onboarded: true }), { status: 200 });
    }
    if (init?.method === 'PATCH') { fetchCalls.push({ url: String(url), init }); return patchAnswer(JSON.parse(String(init.body))); }
    return rig(url, init);
  }) as unknown as typeof fetch);
  await preloadCommentField();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The rail, open on the first thread, as the signed-in author vivek sees it. */
async function openThread() {
  const view = layer({ railOpen: true, canDeleteAny: false }, undefined, { wrap: (ui) => <SessionProvider>{ui()}</SessionProvider> });
  await flush();
  view.runtime.emit({ type: 'mx:annotation-pin', id: THREAD.id, rect: { x: 10, y: 20, width: 300, height: 50 } });
  const thread = await screen.findByLabelText('Annotation thread');
  await waitFor(() => expect(within(thread).getByLabelText('Annotation actions')).toBeTruthy());
  return thread;
}

async function startEditing(thread: HTMLElement) {
  fireEvent.click(within(thread).getByLabelText('Annotation actions'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit comment' }));
  return screen.findByLabelText('Edit comment', { selector: '[contenteditable]' });
}

const patches = () => fetchCalls.filter((call) => call.init?.method === 'PATCH');

describe('editing your own comment', () => {
  it('offers Edit only on comments this viewer wrote', async () => {
    knobs.resolved = [RESOLVED];
    const thread = await openThread();
    fireEvent.click(within(thread).getByLabelText('Annotation actions'));
    expect(screen.getByRole('menuitem', { name: 'Edit comment' })).toHaveTextContent('edit');
    // Not the owner of the document here: delete is offered only for one's own words, edit likewise.
    expect(screen.getByRole('menuitem', { name: 'Delete thread' })).toBeTruthy();
    // The resolved thread's comments are someone else's (a person with no account, an agent): no menu at all.
    await showResolved();
    const resolved = screen.getByLabelText('Resolved annotation thread');
    expect(within(resolved).queryByLabelText('Annotation actions')).toBeNull();
  });

  it('saves the rewritten words against the thread revision and marks the comment edited', async () => {
    const thread = await openThread();
    const field = await startEditing(thread);
    expect(field.textContent).toBe('is this right?');
    replaceComment(field, 'is this the right Q3 figure?');
    fireEvent.click(screen.getByLabelText('Save edit'));
    await flush(); await flush();
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.url).toBe('/api/my/artifacts/doc1/annotations/ann_1');
    expect(JSON.parse(String(patches()[0]!.init!.body))).toEqual({ body: 'is this the right Q3 figure?', expected_revision: 3 });
    await waitFor(() => expect(screen.queryByLabelText('Edit comment', { selector: '[contenteditable]' })).toBeNull());
    expect(within(thread).getByText('is this the right Q3 figure?')).toBeTruthy();
    const first = thread.querySelector<HTMLElement>('[data-comment-id="ann_1"]')!;
    expect(within(first).getByText('edited')).toHaveAttribute('aria-label', expect.stringMatching(/^Edited /));
    const reply = thread.querySelector<HTMLElement>('[data-comment-id="ann_2"]')!;
    expect(within(reply).queryByText('edited')).toBeNull();
  });

  it('Escape cancels: the words come back untouched and nothing is sent', async () => {
    const thread = await openThread();
    const field = await startEditing(thread);
    replaceComment(field, 'half a thought');
    // In a browser the editor's own keymap claims Escape (select parent node) before it bubbles: cancel regardless.
    field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Edit comment', { selector: '[contenteditable]' })).toBeNull());
    expect(within(thread).getByText('is this right?')).toBeTruthy();
    expect(screen.getByLabelText('Annotation thread')).toBe(thread);
    expect(patches()).toHaveLength(0);
  });

  it('Cancel puts the words back too', async () => {
    const thread = await openThread();
    await startEditing(thread);
    fireEvent.click(screen.getByLabelText('Cancel edit'));
    await waitFor(() => expect(screen.queryByLabelText('Edit comment', { selector: '[contenteditable]' })).toBeNull());
    expect(within(thread).getByText('is this right?')).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it('a conflict keeps the draft in the editor and says why; saving again applies it', async () => {
    patchAnswer = () => new Response(JSON.stringify({ error: 'annotation_conflict', current_revision: 5 }), { status: 409 });
    const thread = await openThread();
    const field = await startEditing(thread);
    replaceComment(field, 'my careful rewrite');
    fireEvent.click(screen.getByLabelText('Save edit'));
    expect((await screen.findByRole('alert')).textContent).toContain('This conversation changed while you were editing');
    const still = screen.getByLabelText('Edit comment', { selector: '[contenteditable]' });
    expect(still.textContent).toBe('my careful rewrite');
    patchAnswer = (body) => new Response(JSON.stringify({ ...THREAD, revision: 6, thread: [{ ...THREAD.thread[0]!, body: body.body, edited_at: '2026-10-14T10:00:00Z' }, THREAD.thread[1]!] }), { status: 200 });
    fireEvent.click(screen.getByLabelText('Save edit'));
    // The save goes out after the lazily loaded retry policy; wait for it rather than for the draft's own text.
    await waitFor(() => expect(patches()).toHaveLength(2));
    await waitFor(() => expect(within(thread).getByText('my careful rewrite')).toBeTruthy());
  });
});
