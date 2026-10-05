/* @jsxImportSource solid-js */
/**
 * THE COMPOSER — what a new comment
 * carries and what it must drop. The selection's quote travels with an anchor-relative range, and
 * both are discarded the moment the thing they describe changes: a different durable node at the
 * same path, a widened target, a removed id. A caret comment carries no quote and is still a comment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { fireEvent } from '../../__tests__/helpers';
import { fetchCalls, flush, installAnnotationFetch, knobs, layer } from './annotation-rig';

beforeEach(installAnnotationFetch);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const creates = () => fetchCalls.filter((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
const selects = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
const TEXT = (over: Partial<StoryEditSelection> = {}): StoryEditSelection => ({ kind: 'text', path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [], ...over } as StoryEditSelection);

describe('the annotation composer', () => {
  const online = { id: '11111111-1111-1111-1111-111111111111', name: 'review', online: true, managed: true, exitCode: null, activity: 'listening' };
  const openComposer = () => layer({ initialSelection: TEXT() });

  it('prefills the sole online agent with its stable session target and requires comment text', async () => {
    knobs.sessions = [online, { ...online, id: 'offline', online: false }];
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    expect(field).toHaveValue('@review ');
    expect(screen.getByLabelText('Save annotation')).toBeDisabled();
    fireEvent.input(field, { target: { value: '@review Please update this' } });
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush();
    expect(JSON.parse(String(creates()[0]?.init?.body)).body).toBe('[@review](/chat?session=11111111-1111-1111-1111-111111111111) Please update this');
  });

  it.each([[], [online, { ...online, id: 'second' }], [{ ...online, online: false }], [{ ...online, activity: 'stopped' }], [{...online,runId:'native-box'}]].map((sessions) => ({ sessions })))('leaves new comments empty without a sole eligible online agent: %j', async ({ sessions }) => {
    knobs.sessions = sessions;
    openComposer(); await flush();
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('');
  });

  it.each(['My draft', ''])('preserves an edited draft when sessions arrive late: %j', async (value) => {
    let resolve!: (response: Response) => void;
    const fallback = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url === '/api/remote/sessions' ? new Promise((done) => { resolve = done; }) : fallback(url, init));
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    fireEvent.input(field, { target: { value: 'My draft' } });
    fireEvent.input(field, { target: { value } });
    resolve(new Response(JSON.stringify({ sessions: [online] }))); await flush();
    expect(field).toHaveValue(value);
  });

  it('keeps a removed default removed for the current composer', async () => {
    knobs.sessions = [online];
    openComposer(); await flush();
    const field = screen.getByLabelText('Annotation comment');
    expect(field).toHaveValue('@review ');
    fireEvent.input(field, { target: { value: '' } }); await flush();
    expect(field).toHaveValue('');
  });

  it('keeps the original view context across geometry updates and sends it with the native comment', async () => {
    const viewState = { v: 1 as const, components: { screen: 'checkout', dialog: false } };
    const view = layer({ railOpen: true, initialSelection: TEXT({ viewState }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ nodeId: 'node-1', rect: { x: 9, y: 10, width: 200, height: 40 } }) });
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'Review this view' } });
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush();
    expect(JSON.parse(String(creates()[0]?.init?.body)).view_state).toEqual(viewState);
  });

  it('forwards the selection quote and its anchor-relative range in the create POST', async () => {
    const range = { v: 1 as const, parts: [{ rel: '0', start: 8, end: 12, text: 'grew' }, { rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] };
    layer({ railOpen: true, initialSelection: TEXT({ quote: 'grew 40% in Q3,', range }) });
    await flush();
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'which quarter?' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ path: '1', node_id: 'node-1', body: 'which quarter?', quote: 'grew 40% in Q3,', range });
  });

  it('keeps the captured words when the document re-reports the SAME node', async () => {
    const quoted = TEXT({ nodeId: 'node-1', quote: 'grew 40% in Q3,', range: { v: 1, parts: [{ rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] } });
    const view = layer({ railOpen: true, initialSelection: quoted });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ nodeId: 'node-1', rect: { x: 5, y: 40, width: 200, height: 40 } }) });
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'still about those words' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ quote: quoted.quote, range: quoted.range });
  });

  it('does not inherit a removed target identity into an id-less successor at the same path', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ nodeId: 'old-node', quote: 'old words', range: { v: 1, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] } }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ rect: { x: 5, y: 40, width: 200, height: 40 } }) });
    const composer = await screen.findByLabelText('Annotation comment');
    fireEvent.input(composer, { target: { value: 'draft survives replacement' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(creates()).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for this change to save');
    expect(composer).toHaveValue('draft survives replacement');
  });

  it('drops the old quote and range when the same path reports a different durable node', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ nodeId: 'old-node', quote: 'old words', range: { v: 1, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] } }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: TEXT({ nodeId: 'new-node', rect: { x: 5, y: 40, width: 200, height: 40 } }) });
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'draft follows explicit target' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ path: '1', node_id: 'new-node', body: 'draft follows explicit target' });
  });

  it('drops them when the composer is widened to a DIFFERENT node — they no longer describe it', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ quote: 'grew 40% in Q3,', range: { v: 1, parts: [{ rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] } }) });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { kind: 'element', path: '0', nodeId: 'node-0', tag: 'section', rect: { x: 0, y: 0, width: 400, height: 90 }, className: '', style: '', ancestors: [] } });
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'about the whole section' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ path: '0', node_id: 'node-0', body: 'about the whole section' });
  });

  it('sends no quote for a selection that has none — a caret comment is still a comment', async () => {
    layer({ railOpen: true, initialSelection: TEXT() });
    await flush();
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'no words' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toEqual({ path: '1', node_id: 'node-1', body: 'no words' });
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
    expect(within(popover).getByText('⌘↵ to send')).toBeTruthy();
    expect(within(screen.getByLabelText('Annotation sidebar')).queryByLabelText('Annotation comment')).toBeNull();
    // The breadcrumb: the ancestor is clickable and asks the DOCUMENT to re-select.
    fireEvent.click(screen.getByLabelText('Select section'));
    expect(selects(view.runtime.send).at(-1)).toMatchObject({ path: '2' });

    fireEvent.input(composer, { target: { value: 'fresh note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ path: '2.1', node_id: 'node-2-1', body: 'fresh note' });
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
    fireEvent.input(composer, { target: { value: 'from the keyboard' } });
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
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toContain('Inline style'));
    expect(alert.textContent).toContain('invalid_jsx');
    expect(screen.getByLabelText('Annotation comment')).toBeTruthy();
  });

  it('escape cancels the draft, like the cancel button', async () => {
    const view = layer({ railOpen: true, initialSelection: TEXT({ path: '2.1', ancestors: [{ path: '2', tag: 'section', hint: '' }] }) });
    await flush();
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'never mind' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(selects(view.runtime.send).at(-1)).toMatchObject({ path: null });
    expect(fetchCalls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('creates a relation directly without a source edit or head retry', async () => {
    layer({ railOpen: true, initialSelection: { kind: 'element', path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [{ path: '2', tag: 'section', hint: '' }] } as StoryEditSelection });
    await flush();
    fireEvent.input(await screen.findByLabelText('Annotation comment'), { target: { value: 'mid-sentence note' } });
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
    fireEvent.input(composer, { target: { value: 'keep this draft' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(creates()).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for this change to save');
    expect(composer).toHaveValue('keep this draft');
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
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'Retry me' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('Retry me');
    fail = false;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});
