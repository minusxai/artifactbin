/* @jsxImportSource solid-js */
/**
 * PICKING — the Select tool (components/__tests__/annotation-picking.ui.test.tsx, in Solid). Opening
 * the rail starts a pick; the editor ends one; the document answers with the block (or the drawn
 * area) the reader chose, and the composer opens on it. Includes where the rail sits under the bars.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { Suspense } from 'solid-js';
import * as captureScreen from '@/lib/capture/screen';
import { CaptureError, type CaptureSession } from '@/lib/capture/contract';
import { STORY_ANNOTATION_PIN_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { AnnotationLayer } from '../AnnotationLayer';
import { ANN, NONCE, fetchCalls, flush, httpBackend, installAnnotationFetch, layer, makeRuntime } from './annotation-rig';

beforeEach(installAnnotationFetch);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const pill = () => screen.queryByRole('status', { name: 'Select tool active' });
const creates = () => fetchCalls.filter((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');

describe('picking a block from the rail', () => {
  const PICKED: StoryEditSelection = {
    kind: 'text', path: '2.1', nodeId: 'node-2-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
    ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }],
  };

  it.each(['button', 'keyboard'])('posts by %s and resumes Select without requesting screen sharing', async (submit) => {
    const beginCapture = vi.spyOn(captureScreen, 'beginCapture');
    const view = layer({ railOpen: true, editId: 'edit-current' });
    await flush();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Screenshot' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute('aria-pressed', 'false');
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED });
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'Node comment' } });
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
    expect(screen.queryByLabelText('Upload screenshot')).toBeNull();
    expect(beginCapture).not.toHaveBeenCalled();
    if (submit === 'keyboard') fireEvent.keyDown(screen.getByLabelText('Annotation comment'), { key: 'Enter', ctrlKey: true });
    else fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(JSON.parse(String(creates()[0]!.init!.body))).not.toHaveProperty('attachment_id');
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { ...PICKED, path: '2.2', nodeId: 'node-2-2' } });
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('');
    expect(beginCapture).not.toHaveBeenCalled();
  });

  it('requests sharing only from Screenshot, then captures the selected area', async () => {
    const capture = vi.fn().mockRejectedValue(new CaptureError('geometry'));
    const beginCapture = vi.spyOn(captureScreen, 'beginCapture').mockResolvedValue({ capture, dispose: vi.fn() });
    const view = layer({ railOpen: true, editId: 'edit-current' }); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    expect(beginCapture).toHaveBeenCalledOnce(); await flush();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'area' });
    expect(screen.getByRole('status', { name: 'Screenshot tool active' })).toHaveTextContent('drag an area');
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { ...PICKED, range: { v: 1, kind: 'area', box: { x: 0, y: 0, w: 1, h: 1 } } } });
    expect(capture).toHaveBeenCalledOnce();
    await flush();
    expect(screen.getByLabelText('Upload screenshot')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'Area comment' } });
    expect(screen.getByLabelText('Save annotation')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without screenshot' }));
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
  });

  it('opens the captured area in the on-demand brush editor without putting the page on hold', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const image = { blob: new Blob(['png']), width: 100, height: 50, rect: { x: 5, y: 6, width: 100, height: 50 }, viewport: { width: 800, height: 600 }, capturedAt: '2026-09-30T00:00:00.000Z', method: 'canvas' as const };
    vi.spyOn(captureScreen, 'beginCapture').mockResolvedValue({ capture: vi.fn(async () => image), dispose: vi.fn() });
    const runtime = makeRuntime();
    render(() => <Suspense fallback={<p>page on hold</p>}>
      <AnnotationLayer id="doc1" backend={httpBackend('doc1')} runtimeRef={runtime.ref} sessionNonce={NONCE} railOpen onRailOpenChange={() => {}} editId="edit-current" />
    </Suspense>);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' })); await flush();
    runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { ...PICKED, range: { v: 1, kind: 'area', box: { x: 0, y: 0, w: 1, h: 1 } } } });
    await flush();
    expect(screen.queryByText('page on hold')).toBeNull();
    expect(screen.getByLabelText('Annotation sidebar')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Screenshot editor')).toBeTruthy());
    expect(screen.queryByText('page on hold')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue without screenshot' })).toBeNull();
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'Area with a drawing' } });
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
  });

  it('switching from Screenshot to Select immediately stops an active capture session', async () => {
    const dispose = vi.fn();
    vi.spyOn(captureScreen, 'beginCapture').mockResolvedValue({ capture: vi.fn(), dispose });
    const view = layer({ railOpen: true, editId: 'edit-current' }); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' })); await flush();
    expect(view.runtime.posts().at(-1)).toMatchObject({ mode: 'on', pick: 'area' });
    fireEvent.click(screen.getByLabelText('Select'));
    expect(dispose).toHaveBeenCalledOnce();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
  });

  it('returns to Select when screen-sharing permission is cancelled', async () => {
    vi.spyOn(captureScreen, 'beginCapture').mockRejectedValue(new CaptureError('cancelled'));
    layer({ railOpen: true, editId: 'edit-current' }); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' })); await flush();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Preparing screenshot…')).toBeNull();
  });

  it('switching to Select preserves the draft and disposes a late screen-sharing grant', async () => {
    let grant!: (session: CaptureSession) => void;
    vi.spyOn(captureScreen, 'beginCapture').mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const view = layer({ railOpen: true, editId: 'edit-current' }); await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED });
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    fireEvent.click(screen.getByLabelText('Select'));
    const session = { capture: vi.fn(async () => { throw new Error('Unused capture'); }), dispose: vi.fn() };
    grant(session); await flush();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED });
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('Keep my draft');
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
  });

  it.each(['Cancel annotation', 'Close annotation composer', 'Escape'])('keeps Select ready after dismissing a node comment with %s', async (dismiss) => {
    const beginCapture = vi.spyOn(captureScreen, 'beginCapture');
    const view = layer({ railOpen: true, editId: 'edit-current' }); await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED });
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'Discard this draft' } });
    if (dismiss === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: dismiss }));
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block', selectedPath: null });
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { ...PICKED, path: '2.2', nodeId: 'next-node' } });
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('');
    expect(view.runtime.posts().at(-1)).toMatchObject({ selectedPath: '2.2' });
    expect(beginCapture).not.toHaveBeenCalled();
  });

  it('keeps the Select prompt below the app and editor bars when the document starts at zero', async () => {
    const view = layer({ railOpen: true, topOffset: 44 }, makeRuntime({ left: 0, top: 0, width: 800, height: 600 }));
    await flush();
    expect(pill()).toHaveStyle({ top: '56px' });
    view.set({ railOpen: true, topOffset: 88 });
    expect(pill()).toHaveStyle({ top: '100px' });
  });

  it('the context/selection action activates Select with the rail closed', async () => {
    const view = layer({ railOpen: false });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_ACTION_MESSAGE, action: 'select', selection: PICKED });
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  });

  it('a Select pressed before the layer arrived is started on mount', async () => {
    const view = layer({ railOpen: false, pickRequested: true });
    await flush();
    expect(pill()).not.toBeNull();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
  });

  it('the rail opens WITH a pick on; the tool is still there to turn it off and on again', async () => {
    const view = layer({ railOpen: true });
    await flush();
    expect(view.runtime.posts().at(-1)).toMatchObject({ mode: 'on', pick: 'block' });
    expect(pill()).toHaveTextContent(/click a block/i);
    const tool = within(screen.getByLabelText('Annotation sidebar')).getByLabelText('Select');
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(pill()).toBeNull();
    expect(view.runtime.posts().at(-1)).toMatchObject({ mode: 'on', pick: null });
    fireEvent.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    expect(view.runtime.posts().at(-1)).toMatchObject({ mode: 'on', pick: 'block' });
    fireEvent.click(screen.getByLabelText('Cancel picking'));
    expect(pill()).toBeNull();
    expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: null });
  });

  it('the document\'s pick opens the composer on that block and ends the pick; save goes to the picked block', async () => {
    const view = layer({ railOpen: true });
    await flush();
    expect(pill()).not.toBeNull();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED });
    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(screen.getByLabelText('Select section')).toBeTruthy();
    expect(pill()).toBeNull();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'false');
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: null, selectedPath: '2.1' });
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'picked note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const body = JSON.parse(String(creates()[0]!.init!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ path: '2.1', node_id: 'node-2-1', body: 'picked note' });
    expect(body).not.toHaveProperty('quote');
  });

  it('a null selection from the document (escape there) just stands the pick down', async () => {
    const view = layer({ railOpen: true });
    await flush();
    expect(pill()).not.toBeNull();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: null });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(pill()).toBeNull();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: null });
  });

  it('escape on the page cancels the pick too', async () => {
    const view = layer({ railOpen: true });
    await flush();
    expect(pill()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pill()).toBeNull();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: null });
  });

  it('outside a pick, a document selection with no composer open is the editor\'s caret and opens nothing', async () => {
    const view = layer({ railOpen: true });
    await flush();
    fireEvent.click(screen.getByLabelText('Cancel picking'));
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  });

  it('on a phone, starting a pick puts the sheet away so the document can be tapped', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    try {
      const onRailOpenChange = vi.fn();
      const view = layer({ railOpen: true, onRailOpenChange });
      await flush();
      expect(pill()).toBeNull(); // a phone's sheet covers the document: no pick starts by itself
      expect(onRailOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Annotation sidebar' })).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Select'));
      expect(onRailOpenChange).toHaveBeenCalledWith(false);
      expect(pill()).not.toBeNull();
      expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
      view.set({ railOpen: false, onRailOpenChange });
      expect(pill()).not.toBeNull(); // the pick that put the sheet away survives its closing
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    }
  });
});

describe('opening the rail opens a pick', () => {
  const picks = (view: ReturnType<typeof layer>) => view.runtime.posts().map((message) => message.pick);

  it('starts when the rail opens, and ends when it closes', async () => {
    const view = layer({ railOpen: false });
    await flush();
    expect(pill()).toBeNull();
    expect(picks(view).at(-1)).toBe(null);
    view.set({ railOpen: true });
    await flush();
    expect(pill()).not.toBeNull();
    expect(picks(view).at(-1)).toBe('block');
    view.set({ railOpen: false });
    await flush();
    expect(pill()).toBeNull();
    expect(picks(view).at(-1)).toBe(null);
  });

  it('does not start when the rail was opened for a thread', async () => {
    const onRailOpenChange = vi.fn();
    const view = layer({ railOpen: false, onRailOpenChange });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: ANN.id, rect: { x: 0, y: 0, width: 10, height: 10 } });
    expect(onRailOpenChange).toHaveBeenCalledWith(true);
    view.set({ railOpen: true, onRailOpenChange });
    await flush();
    expect(pill()).toBeNull();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'false');
  });

  it('never starts under the editor, and a pick already on ends when the editor opens', async () => {
    const view = layer({ railOpen: true, pickOnOpen: false });
    await flush();
    expect(pill()).toBeNull();
    fireEvent.click(screen.getByLabelText('Select'));
    expect(pill()).not.toBeNull();
    view.set({ railOpen: true, pickOnOpen: true });
    await flush();
    expect(pill()).not.toBeNull();
    view.set({ railOpen: true, pickOnOpen: false });
    await flush();
    expect(pill()).toBeNull();
  });

  it('a composer arriving by another route ends the pick', async () => {
    const view = layer({ railOpen: true });
    await flush();
    expect(pill()).not.toBeNull();
    view.set({ railOpen: true, initialSelection: { kind: 'text', path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] } as StoryEditSelection });
    await flush();
    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(pill()).toBeNull();
  });
});

describe('drawing an area from the rail', () => {
  const AREA = { v: 1 as const, kind: 'area' as const, box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } };
  const PICKED_AREA: StoryEditSelection = { kind: 'element', path: '2', nodeId: 'node-2', tag: 'section', rect: { x: 5, y: 6, width: 400, height: 200 }, className: 'max-w-2xl', style: '', ancestors: [], range: AREA };

  it('Select toggles node and text selection', async () => {
    const view = layer({ railOpen: true });
    await flush();
    const tool = screen.getByLabelText('Select');
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Draw an area to comment on')).toBeNull();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
    expect(pill()).toHaveTextContent(/click a block or highlight text/i);
    fireEvent.click(tool);
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: null });
    fireEvent.click(tool);
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: 'block' });
  });

  it('an area pick opens the composer on its anchor and saves the area as the range, with no quote', async () => {
    const view = layer({ railOpen: true });
    await flush();
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: PICKED_AREA });
    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(view.runtime.posts().at(-1)).toMatchObject({ pick: null, selectedPath: '2' });
    // The document re-reports the SAME node's geometry on scroll, without the range; the area survives it.
    view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: { ...PICKED_AREA, range: undefined, rect: { x: 5, y: 60, width: 400, height: 200 } } });
    fireEvent.input(screen.getByLabelText('Annotation comment'), { target: { value: 'this whole region' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const body = JSON.parse(String(creates()[0]!.init!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ path: '2', node_id: 'node-2', body: 'this whole region', range: AREA });
    expect(body).not.toHaveProperty('quote');
  });

  it('hands an area thread\'s range to the document with its pin', async () => {
    const view = layer({ railOpen: false, liveAnnotations: [{ ...ANN, id: 'ann_area', range: AREA }] });
    await flush();
    const pins = view.runtime.posts().flatMap((message) => message.pins as Array<{ id: string; range: unknown }>);
    expect(pins).toContainEqual(expect.objectContaining({ id: 'ann_area', range: AREA }));
  });
});

describe('the rail under the bar', () => {
  it('starts at the offset the page gives it and leaves the document\'s scrollbar visible', async () => {
    layer({ railOpen: true, topOffset: 44, rightInset: 15 });
    await flush();
    const rail = screen.getByLabelText('Annotation sidebar');
    expect(rail.style.top).toBe('44px');
    expect(rail.style.right).toBe('15px');
    expect(rail.style.width).toBe('320px');
  });
});

it('does not replay unchanged area state in response to a geometry-only echo', async () => {
  const selected: StoryEditSelection = { kind: 'element', path: '1', nodeId: 'node-1', tag: 'section', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [], range: { v: 1, kind: 'area', box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } };
  const view = layer({ railOpen: true, initialSelection: selected }); await flush();
  view.runtime.send.mockClear();
  const { range: _range, ...geometry } = selected;
  view.runtime.emit({ type: STORY_SELECTION_MESSAGE, selection: geometry }); await flush();
  expect(view.runtime.posts()).toHaveLength(0);
});
