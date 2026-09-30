/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { createSignal } from 'solid-js';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { AnnotationWire } from '@/lib/annotations';
import type { StoryController, StoryEditSelection } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { AnnotationLayer } from '../AnnotationLayer';

const selected: StoryEditSelection = { kind: 'element', path: '2.1', nodeId: 'node-2-1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [{ path: '2', tag: 'section', hint: '' }] };
const area = { v: 1 as const, kind: 'area' as const, box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } };
const located = { id: 'ann1', status: 'open', snippet: 'Passage', anchor: { path: '2', key: 'k' }, thread: [{ id: 'c1', body: 'A note', author: { label: 'Ada' }, created_at: new Date().toISOString() }] } as AnnotationWire;
const backend = (overrides: Partial<ArtifactBackend> = {}) => ({ listAnnotations: vi.fn(async () => [located]), createAnnotation: vi.fn(async () => located), actOnAnnotation: vi.fn(), deleteAnnotation: vi.fn(), unavailable: vi.fn(() => null), remoteSessions: vi.fn(async () => ({ sessions: [] })), members: vi.fn(async () => ({ people: [] })), ...overrides }) as unknown as ArtifactBackend;
const runtime = () => {
  let receive: ((data: unknown) => void) | undefined;
  const send = vi.fn();
  const current = { send, subscribe: (listener: (data: unknown) => void) => { receive = listener; return () => {}; }, getViewportRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as StoryController;
  return { ref: { current }, send, emit: (type: string, details: Record<string, unknown> = {}) => receive?.({ type, nonce: 'private', ...details }), last: () => send.mock.calls.map(([message]) => message).filter(message => message.type === 'mx:annotations').at(-1) };
};
function mount(options: { railOpen?: boolean; pickOnOpen?: boolean; railSheet?: boolean; editId?: string; topOffset?: number; rightInset?: number; initialSelection?: StoryEditSelection; liveAnnotations?: AnnotationWire[]; backend?: ArtifactBackend } = {}) {
  const frame = runtime(); let setRail!: (value: boolean) => void; let setCanPick!: (value: boolean) => void; let setSelection!: (value: StoryEditSelection | undefined) => void;
  const change = vi.fn((value: boolean) => setRail(value));
  const view = render(() => {
    const [railOpen, rail] = createSignal(options.railOpen ?? true);
    const [canPick, pick] = createSignal(options.pickOnOpen ?? true);
    const [initialSelection, choose] = createSignal(options.initialSelection);
    setRail = rail; setCanPick = pick; setSelection = choose;
    return <AnnotationLayer id="abc" backend={options.backend ?? backend()} railOpen={railOpen()} onRailOpenChange={change} pickOnOpen={canPick()} railSheet={options.railSheet} editId={options.editId}
      topOffset={options.topOffset} rightInset={options.rightInset} initialSelection={initialSelection()} liveAnnotations={options.liveAnnotations} runtimeRef={frame.ref} sessionNonce="private" />;
  });
  return { view, frame, change, setRail, setCanPick, setSelection };
}
afterEach(() => vi.restoreAllMocks());

it('requires a screenshot by default on a versioned document and makes text-only fallback explicit', async () => {
  const { view, frame } = mount({ editId: 'edit-current' });
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Select' }));
  frame.emit('mx:selection', { selection: selected });
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'Explicit fallback' } });
  await waitFor(() => expect(view.getByRole('button', { name: 'Post comment' })).toBeDisabled());
  expect(view.getByLabelText('Upload screenshot')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Continue without screenshot' }));
  expect(view.getByRole('button', { name: 'Post comment' })).toBeEnabled();
});

it('keeps the Select prompt below the app and editor bars when the document starts at zero', () => {
  const { view } = mount({ topOffset: 44 });
  expect(view.getByRole('status', { name: 'Select tool active' })).toHaveStyle({ top: '56px' });
});

it('the context/selection action activates Select with the rail closed', () => {
  const { view, frame } = mount({ railOpen: false });
  frame.emit('mx:selection-action', { action: 'select', selection: selected });
  expect(frame.last()).toMatchObject({ pick: 'select' });
  expect(view.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
});

it('the rail opens WITH a pick on; the tool still turns it off and on', () => {
  const { view, frame } = mount(); const tool = view.getByRole('button', { name: 'Select' });
  expect(frame.last()).toMatchObject({ pick: 'select' });
  fireEvent.click(tool); expect(frame.last()).toMatchObject({ pick: null }); expect(tool).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(tool); expect(frame.last()).toMatchObject({ pick: 'select' });
  fireEvent.click(view.getByRole('button', { name: 'Cancel picking' })); expect(frame.last()).toMatchObject({ pick: null });
});

it('the frame pick opens the composer and save goes to the picked block', async () => {
  const service = backend(); const { view, frame } = mount({ backend: service });
  frame.emit('mx:selection', { selection: selected });
  expect(view.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Select section' })).toBeTruthy();
  expect(frame.last()).toMatchObject({ pick: null, selectedPath: '2.1' });
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'picked note' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(service.createAnnotation).toHaveBeenCalledWith({ path: '2.1', node_id: 'node-2-1', body: 'picked note' }, expect.any(String)));
});

it('a null selection from the frame stands the pick down', () => {
  const { view, frame } = mount(); frame.emit('mx:selection', { selection: null });
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull(); expect(frame.last()).toMatchObject({ pick: null });
});

it('escape on the page cancels the pick', () => {
  const { view, frame } = mount(); fireEvent.keyDown(window, { key: 'Escape' });
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull(); expect(frame.last()).toMatchObject({ pick: null });
});

it('outside a pick, an editor caret selection opens nothing', () => {
  const { view, frame } = mount(); fireEvent.click(view.getByRole('button', { name: 'Cancel picking' }));
  frame.emit('mx:selection', { selection: selected }); expect(view.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
});

it('on a phone, starting a pick puts the sheet away', () => {
  const { view, frame, change } = mount({ railSheet: true });
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Select' }));
  expect(change).toHaveBeenCalledWith(false); expect(frame.last()).toMatchObject({ pick: 'select' });
});

it('starts when the rail opens and ends when it closes', () => {
  const { view, frame, setRail } = mount({ railOpen: false });
  expect(frame.last()).toMatchObject({ pick: null }); setRail(true); expect(frame.last()).toMatchObject({ pick: 'select' });
  setRail(false); expect(frame.last()).toMatchObject({ pick: null }); expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull();
});

it('does not start when the rail was opened for a thread', () => {
  const { view, frame } = mount({ railOpen: false });
  frame.emit('mx:annotation-pin', { id: 'ann1' });
  expect(view.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
});

it('never starts under the editor, and an existing pick ends when the editor opens', () => {
  const { view, setCanPick } = mount({ pickOnOpen: false });
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Select' }));
  expect(view.getByRole('status', { name: 'Select tool active' })).toBeTruthy();
  setCanPick(true); setCanPick(false);
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull();
});

it('a composer arriving by another route ends the pick', () => {
  const { view, setSelection } = mount(); setSelection(selected);
  expect(view.queryByRole('status', { name: 'Select tool active' })).toBeNull();
  expect(view.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
});

it('one Select tool toggles block and area selection together', () => {
  const { view, frame } = mount(); const tool = view.getByRole('button', { name: 'Select' });
  expect(view.getByRole('status', { name: 'Select tool active' })).toHaveTextContent('tap a block or drag an area');
  fireEvent.click(tool); expect(frame.last()).toMatchObject({ pick: null });
  fireEvent.click(tool); expect(frame.last()).toMatchObject({ pick: 'select' });
});

it('an area pick saves the area as the range without a quote after a geometry echo', async () => {
  const service = backend(); const { view, frame } = mount({ backend: service });
  frame.emit('mx:selection', { selection: { ...selected, range: area } });
  frame.emit('mx:selection', { selection: { ...selected, rect: { ...selected.rect, y: 60 } } });
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'this region' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(service.createAnnotation).toHaveBeenCalledWith({ path: '2.1', node_id: 'node-2-1', body: 'this region', range: area }, expect.any(String)));
});

it('hands an area thread range to the frame with its pin', () => {
  const { frame } = mount({ railOpen: false, liveAnnotations: [{ ...located, range: area }] });
  expect(frame.last().pins).toContainEqual(expect.objectContaining({ id: 'ann1', range: area }));
});

it('starts at the offset the page gives it and leaves the document scrollbar visible', () => {
  const { view } = mount({ topOffset: 44, rightInset: 15 });
  expect(view.getByLabelText('Annotation sidebar')).toHaveStyle({ top: '44px', right: '15px' });
});

it('does not replay unchanged area state in response to a geometry-only echo', () => {
  const { frame } = mount({ initialSelection: { ...selected, range: area } });
  frame.send.mockClear(); frame.emit('mx:selection', { selection: selected });
  expect(frame.send.mock.calls.filter(([message]) => message.type === 'mx:annotations')).toHaveLength(0);
});
