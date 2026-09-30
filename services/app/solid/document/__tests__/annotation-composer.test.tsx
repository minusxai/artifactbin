/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { StoryController, StoryEditSelection } from '@/lib/story-runtime/contract';
import { remoteMention } from '@/lib/remote-reply';
import type { RemoteSessionInfo } from '../../../../contracts/src/remote';
import { fireEvent, render } from '../../__tests__/helpers';
import { AnnotationLayer } from '../AnnotationLayer';

const selection: StoryEditSelection = { kind: 'text', path: '1', nodeId: 'node-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] };
const session = { id: '11111111-1111-1111-1111-111111111111', name: 'review', online: true, managed: true, exitCode: null, activity: 'listening', harness: 'codex', cwd: '/', machine: 'local', cols: 80, rows: 24, controller: 'local', createdAt: new Date().toISOString() } satisfies RemoteSessionInfo;
const service = (overrides: Partial<ArtifactBackend> = {}) => ({
  listAnnotations: vi.fn(async () => []), createAnnotation: vi.fn(async (input: unknown) => ({ id: 'created', status: 'open', snippet: 'passage', thread: [{ id: 'c1', body: (input as { body: string }).body, author: { label: 'You' }, created_at: new Date().toISOString() }] })),
  actOnAnnotation: vi.fn(), deleteAnnotation: vi.fn(), unavailable: vi.fn(() => null),
  remoteSessions: vi.fn(async () => ({ sessions: [] })), members: vi.fn(async () => ({ people: [] })), ...overrides,
}) as unknown as ArtifactBackend;
const runtime = () => {
  let receive: ((data: unknown) => void) | undefined;
  const send = vi.fn();
  const controller = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 0, top: 100, width: 800, height: 600 }) } as unknown as StoryController;
  return { ref: { current: controller }, send, report: (next: StoryEditSelection | null) => receive?.({ type: 'mx:selection', nonce: 'private', selection: next }) };
};
const mount = (backend = service(), initial: StoryEditSelection = selection, options: { railOpen?: boolean; runtime?: ReturnType<typeof runtime> } = {}) => {
  const frame = options.runtime ?? runtime();
  const view = render(() => <AnnotationLayer id="doc1" backend={backend} railOpen={options.railOpen ?? true} onRailOpenChange={() => {}} initialSelection={initial} runtimeRef={frame.ref} sessionNonce="private" pickOnOpen={false} />);
  return { view, frame };
};
const write = (view: ReturnType<typeof render>, value: string) => { fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value } }); fireEvent.click(view.getByRole('button', { name: 'Post comment' })); };
afterEach(() => vi.restoreAllMocks());

it('prefills the sole online agent with its stable session target and requires comment text', async () => {
  const backend = service({ remoteSessions: vi.fn(async () => ({ sessions: [session, { ...session, id: 'offline', online: false }] })) as ArtifactBackend['remoteSessions'] });
  const { view } = mount(backend);
  await waitFor(() => expect(view.getByRole('textbox', { name: 'New comment' })).toHaveValue('@review '));
  expect(view.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  write(view, '@review Please update this');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ body: `${remoteMention(session as Parameters<typeof remoteMention>[0])}Please update this` }), expect.any(String)));
});

it.each([
  [], [session, { ...session, id: 'second' }], [{ ...session, online: false }], [{ ...session, activity: 'stopped' }],
].map(sessions => ({ sessions })))('leaves new comments empty without a sole eligible online agent: %j', async ({ sessions }) => {
  const { view } = mount(service({ remoteSessions: vi.fn(async () => ({ sessions })) as ArtifactBackend['remoteSessions'] }));
  await waitFor(() => expect(view.getByRole('textbox', { name: 'New comment' })).toHaveValue(''));
});

it.each(['My draft', ''])('preserves an edited draft when sessions arrive late: %j', async value => {
  let resolve!: (answer: { sessions: typeof session[] }) => void;
  const { view } = mount(service({ remoteSessions: vi.fn(() => new Promise(done => { resolve = done; })) as ArtifactBackend['remoteSessions'] }));
  const field = view.getByRole('textbox', { name: 'New comment' });
  fireEvent.input(field, { target: { value: 'My draft' } });
  fireEvent.input(field, { target: { value } });
  resolve({ sessions: [session] });
  await waitFor(() => expect(field).toHaveValue(value));
});

it('keeps a removed default removed for the current composer', async () => {
  const { view } = mount(service({ remoteSessions: vi.fn(async () => ({ sessions: [session] })) as ArtifactBackend['remoteSessions'] }));
  const field = view.getByRole('textbox', { name: 'New comment' });
  await waitFor(() => expect(field).toHaveValue('@review '));
  fireEvent.input(field, { target: { value: '' } });
  expect(field).toHaveValue('');
});

it('forwards the selection quote and its anchor-relative range in the create POST', async () => {
  const backend = service();
  const quoted = { ...selection, quote: 'grew 40% in Q3,', range: { v: 1 as const, parts: [{ rel: '0', start: 8, end: 12, text: 'grew' }, { rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] } };
  const { view } = mount(backend, quoted);
  write(view, 'which quarter?');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith({ path: '1', node_id: 'node-1', body: 'which quarter?', quote: quoted.quote, range: quoted.range }, expect.any(String)));
});

it('keeps the captured words when the frame re-reports the SAME node', async () => {
  const backend = service(); const quoted = { ...selection, quote: 'old words', range: { v: 1 as const, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] } };
  const { view, frame } = mount(backend, quoted);
  frame.report({ ...selection, rect: { ...selection.rect, y: 40 } });
  write(view, 'still those words');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ quote: quoted.quote, range: quoted.range }), expect.any(String)));
});

it('does not inherit a removed target identity into an id-less successor at the same path', async () => {
  const backend = service(); const { view, frame } = mount(backend, { ...selection, nodeId: 'old-node', quote: 'old words' });
  frame.report({ ...selection, nodeId: undefined });
  write(view, 'draft survives replacement');
  expect(backend.createAnnotation).not.toHaveBeenCalled();
  expect(view.getByRole('alert')).toHaveTextContent('Wait for this change to save');
  expect(view.getByRole('textbox', { name: 'New comment' })).toHaveValue('draft survives replacement');
});

it('drops the old quote and range when the same path reports a different durable node', async () => {
  const backend = service(); const { view, frame } = mount(backend, { ...selection, nodeId: 'old-node', quote: 'old words' });
  frame.report({ ...selection, nodeId: 'new-node' }); write(view, 'draft follows explicit target');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith({ path: '1', node_id: 'new-node', body: 'draft follows explicit target' }, expect.any(String)));
});

it('drops the quote and range when the composer is widened to a DIFFERENT node', async () => {
  const backend = service(); const { view, frame } = mount(backend, { ...selection, quote: 'old words' });
  frame.report({ ...selection, kind: 'element', path: '0', nodeId: 'node-0', tag: 'section' }); write(view, 'whole section');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith({ path: '0', node_id: 'node-0', body: 'whole section' }, expect.any(String)));
});

it('sends no quote for a selection that has none — a caret comment is still a comment', async () => {
  const backend = service(); const { view } = mount(backend); write(view, 'no words');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith({ path: '1', node_id: 'node-1', body: 'no words' }, expect.any(String)));
});

it('a handed-in selection opens an anchored page composer; save moves the comment to the rail', async () => {
  const backend = service(); const frame = runtime();
  const chosen = { ...selection, kind: 'element' as const, path: '2.1', nodeId: 'node-2-1', tag: 'div', ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }] };
  const { view } = mount(backend, chosen, { runtime: frame });
  const composer = view.getByRole('dialog', { name: 'Annotation composer' });
  expect(composer).toHaveStyle({ left: '84px', top: '158px', width: '384px' });
  fireEvent.click(view.getByRole('button', { name: 'Select section' }));
  expect(frame.send).toHaveBeenCalledWith({ type: 'mx:select', path: '2' });
  write(view, 'fresh note');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ path: '2.1', node_id: 'node-2-1', body: 'fresh note' }), expect.any(String)));
  expect(view.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  expect(view.getByText('fresh note')).toBeTruthy();
});

it('submits the composer with command-enter and gives only Comment the filled treatment', async () => {
  const backend = service(); const { view } = mount(backend);
  expect(view.getByRole('button', { name: 'Cancel comment' })).toHaveClass('bg-transparent');
  expect(view.getByRole('button', { name: 'Post comment' })).toHaveClass('bg-accent');
  const field = view.getByRole('textbox', { name: 'New comment' });
  fireEvent.input(field, { target: { value: 'from the keyboard' } });
  fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ body: 'from the keyboard' }), expect.any(String)));
});

it('opens the composer on a text selection handed in from view mode', () => {
  const frame = runtime(); const { view } = mount(service(), selection, { runtime: frame });
  expect(view.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
  expect(frame.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', selectedPath: '1' }));
});

it('shows the anchor edit refusal instead of silently swallowing it', async () => {
  const backend = service({ createAnnotation: vi.fn(async () => { throw new Error('invalid_jsx: Inline style'); }) });
  const { view } = mount(backend); write(view, 'note');
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('invalid_jsx: Inline style'));
  expect(view.getByRole('textbox', { name: 'New comment' })).toBeTruthy();
});

it('escape cancels the draft, like the cancel button', () => {
  const backend = service(); const frame = runtime(); const { view } = mount(backend, selection, { runtime: frame });
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'never mind' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(view.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  expect(frame.send).toHaveBeenCalledWith({ type: 'mx:select', path: null });
  expect(backend.createAnnotation).not.toHaveBeenCalled();
});

it('creates a relation directly without a source edit or head retry', async () => {
  const backend = service(); const { view } = mount(backend); write(view, 'mid-sentence note');
  await waitFor(() => expect(backend.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ node_id: 'node-1', body: 'mid-sentence note' }), expect.any(String)));
  expect(backend.createAnnotation).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(backend.createAnnotation).mock.calls[0]?.[0])).not.toContain('edit_id');
});

it('keeps an unsaved-node draft and asks the user to wait for ordinary autosave', () => {
  const backend = service(); const { view } = mount(backend, { ...selection, nodeId: undefined });
  write(view, 'keep this draft');
  expect(backend.createAnnotation).not.toHaveBeenCalled();
  expect(view.getByRole('alert')).toHaveTextContent('Wait for this change to save');
  expect(view.getByRole('textbox', { name: 'New comment' })).toHaveValue('keep this draft');
});
