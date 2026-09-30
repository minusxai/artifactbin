/**
 * PICKING — the Select tool. Opening the rail starts a pick; the editor ends
 * one; the frame answers with the block (or the drawn area) the reader chose,
 * and the composer opens on it. Includes where the rail sits under the bars.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as captureScreen from '@/lib/capture/screen';
import type { CaptureSession } from '@/lib/capture/contract';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  STORY_ANNOTATIONS_MESSAGE,
  STORY_ANNOTATION_PIN_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_SELECTION_ACTION_MESSAGE,
} from '@/lib/story-runtime/contract';
import {
  ANN,
  NONCE,
  fetchCalls,
  flush,
  fromFrame,
  installAnnotationFetch,
  layer,
  makeFrame,
} from '@/test/helpers/annotation-layer';

beforeEach(installAnnotationFetch);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('picking a block from the rail', () => {
  const PICKED = {
    kind: 'text' as const, path: '2.1', nodeId: 'node-2-1', tag: 'p',
    rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
    ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }],
  };
  const annotationsMessages = (postMessage: ReturnType<typeof vi.fn>) =>
    postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE);
  const pill = () => screen.queryByRole('status', { name: 'Select tool active' });

  it.each(['button', 'keyboard'])('posts by %s and resumes Select without requesting screen sharing', async (submit) => {
    const beginCapture = vi.spyOn(captureScreen, 'beginCapture');
    const {frame,contentWindow}=makeFrame();
    render(layer(frame,{railOpen:true,editId:'edit-current'}));
    await flush();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Screenshot' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute('aria-pressed', 'false');
    await fromFrame(contentWindow,{type:STORY_SELECTION_MESSAGE,nonce:NONCE,selection:PICKED});
    fireEvent.change(screen.getByLabelText('Annotation comment'),{target:{value:'Node comment'}});
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
    expect(screen.queryByLabelText('Upload screenshot')).toBeNull();
    expect(beginCapture).not.toHaveBeenCalled();
    if (submit === 'keyboard') fireEvent.keyDown(screen.getByLabelText('Annotation comment'), { key: 'Enter', ctrlKey: true });
    else fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find(call => call.url.endsWith('/annotations') && call.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).not.toHaveProperty('attachment_id');
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    await fromFrame(contentWindow,{type:STORY_SELECTION_MESSAGE,nonce:NONCE,selection:{...PICKED,path:'2.2',nodeId:'node-2-2'}});
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('');
    expect(beginCapture).not.toHaveBeenCalled();
  });

  it('requests sharing only from Screenshot, then captures the selected area', async () => {
    const capture = vi.fn().mockRejectedValue(new captureScreen.CaptureError('geometry'));
    const beginCapture = vi.spyOn(captureScreen, 'beginCapture').mockResolvedValue({ capture, dispose: vi.fn() });
    const { frame, contentWindow, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' })); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    expect(beginCapture).toHaveBeenCalledOnce(); await flush();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: 'area' });
    expect(screen.getByRole('status', { name: 'Screenshot tool active' })).toHaveTextContent('drag an area');
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: { ...PICKED, range: { v: 1, kind: 'area', box: { x: 0, y: 0, w: 1, h: 1 } } } });
    expect(capture).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Upload screenshot')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Annotation comment'), { target: { value: 'Area comment' } });
    expect(screen.getByLabelText('Save annotation')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without screenshot' }));
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
  });

  it('switching from Screenshot to Select immediately stops an active capture session', async () => {
    const dispose = vi.fn();
    vi.spyOn(captureScreen, 'beginCapture').mockResolvedValue({ capture: vi.fn(), dispose });
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' })); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' })); await flush();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ mode: 'on', pick: 'area' });
    fireEvent.click(screen.getByLabelText('Select'));
    expect(dispose).toHaveBeenCalledOnce();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: 'block' });
  });

  it('returns to Select when screen-sharing permission is cancelled', async () => {
    vi.spyOn(captureScreen, 'beginCapture').mockRejectedValue(new captureScreen.CaptureError('cancelled'));
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' })); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' })); await flush();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Preparing screenshot…')).toBeNull();
  });

  it('switching to Select preserves the draft and disposes a late screen-sharing grant', async () => {
    let grant!: (session: CaptureSession) => void;
    vi.spyOn(captureScreen, 'beginCapture').mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    const { frame, contentWindow, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' })); await flush();
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });
    fireEvent.change(screen.getByLabelText('Annotation comment'), { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    fireEvent.click(screen.getByLabelText('Select'));
    const session = { capture: vi.fn(async () => { throw new Error('Unused capture'); }), dispose: vi.fn() }; grant(session); await flush();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: 'block' });
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('Keep my draft');
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
  });

  it.each(['Cancel annotation', 'Close annotation composer', 'Escape'])('keeps Select ready after dismissing a node comment with %s', async dismiss => {
    const beginCapture = vi.spyOn(captureScreen, 'beginCapture');
    const { frame, contentWindow, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true, editId: 'edit-current' })); await flush();
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });
    fireEvent.change(screen.getByLabelText('Annotation comment'), { target: { value: 'Discard this draft' } });
    if (dismiss === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: dismiss }));
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'true');
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: 'block', selectedPath: null });
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: { ...PICKED, path: '2.2', nodeId: 'next-node' } });
    expect(screen.getByLabelText('Annotation comment')).toHaveValue('');
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ selectedPath: '2.2' });
    expect(beginCapture).not.toHaveBeenCalled();
  });

  it('keeps the Select prompt below the app and editor bars when the document starts at zero', async () => {
    const { frame } = makeFrame();
    frame.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 600 } as DOMRect);
    const view = render(layer(frame, { railOpen: true, topOffset: 44 }));
    await flush();
    expect(pill()).toHaveStyle({ top: '56px' });
    view.rerender(layer(frame, { railOpen: true, topOffset: 88 }));
    expect(pill()).toHaveStyle({ top: '100px' });
  });

  it('the context/selection action activates Select with the rail closed', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: false }));
    await flush();
    await fromFrame(contentWindow, { type: STORY_SELECTION_ACTION_MESSAGE, nonce: NONCE, action: 'select', selection: PICKED });
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: 'block' });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  });

  it('the rail opens WITH a pick on; the tool is still there to turn it off and on again', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    // Opening the rail is opening the pick: the next click in the document is a comment.
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ mode: 'on', pick: 'block' });
    expect(pill()).toHaveTextContent(/click a block/i);
    const tool = within(screen.getByLabelText('Annotation sidebar')).getByLabelText('Select');
    expect(tool).toHaveAttribute('aria-pressed', 'true');

    // The tool stays an explicit choice: pressing it again turns the pick off.
    fireEvent.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(pill()).toBeNull();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ mode: 'on', pick: null });
    fireEvent.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ mode: 'on', pick: 'block' });

    fireEvent.click(screen.getByLabelText('Cancel picking'));
    expect(pill()).toBeNull();
    expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: null });
  });

  it('the frame\'s pick opens the composer on that block and ends the pick; save goes to the picked block', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    expect(pill()).not.toBeNull(); // opened picking
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });

    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(screen.getByLabelText('Select section')).toBeTruthy(); // the breadcrumb, so it can still widen
    expect(pill()).toBeNull();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'false');
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: null, selectedPath: '2.1' });

    fireEvent.change(screen.getByLabelText('Annotation comment'), { target: { value: 'picked note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');
    const body = JSON.parse(String(create!.init!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ path: '2.1', node_id: 'node-2-1', body: 'picked note' });
    expect(body).not.toHaveProperty('quote');
  });

  it('a null selection from the frame (escape in the document) just stands the pick down', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    expect(pill()).not.toBeNull(); // opened picking
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: null });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(pill()).toBeNull();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: null });
  });

  it('escape on the page cancels the pick too', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    expect(pill()).not.toBeNull(); // opened picking
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pill()).toBeNull();
    expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: null });
  });

  it('outside a pick, a frame selection with no composer open is the editor\'s caret and opens nothing', async () => {
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    fireEvent.click(screen.getByLabelText('Cancel picking'));
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
  });

  it('on a phone, starting a pick puts the sheet away so the document can be tapped', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    try {
      const { frame, postMessage } = makeFrame();
      const onRailOpenChange = vi.fn();
      render(layer(frame, { railOpen: true, onRailOpenChange }));
      await flush();
      expect(pill()).toBeNull(); // a phone's sheet covers the document: no pick starts by itself
      expect(onRailOpenChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByLabelText('Select'));
      expect(onRailOpenChange).toHaveBeenCalledWith(false);
      expect(pill()).not.toBeNull();
      expect(annotationsMessages(postMessage).at(-1)).toMatchObject({ pick: 'block' });
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    }
  });
});

describe('opening the rail opens a pick', () => {
  const pill = () => screen.queryByRole('status', { name: 'Select tool active' });
  const picks = (postMessage: ReturnType<typeof vi.fn>) =>
    postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE).map((message) => message.pick);

  it('starts when the rail opens, and ends when it closes', async () => {
    const { frame, postMessage } = makeFrame();
    const { rerender } = render(layer(frame, { railOpen: false }));
    await flush();
    expect(pill()).toBeNull();
    expect(picks(postMessage).at(-1)).toBe(null);

    rerender(layer(frame, { railOpen: true }));
    await flush();
    expect(pill()).not.toBeNull();
    expect(picks(postMessage).at(-1)).toBe('block');

    rerender(layer(frame, { railOpen: false }));
    await flush();
    expect(pill()).toBeNull();
    expect(picks(postMessage).at(-1)).toBe(null);
  });

  it('does not start when the rail was opened for a thread', async () => {
    const { frame, contentWindow } = makeFrame();
    const onRailOpenChange = vi.fn();
    const { rerender } = render(layer(frame, { railOpen: false, onRailOpenChange }));
    await flush();
    await fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: ANN.id, rect: { x: 0, y: 0, width: 10, height: 10 } });
    expect(onRailOpenChange).toHaveBeenCalledWith(true);
    rerender(layer(frame, { railOpen: true, onRailOpenChange }));
    await flush();
    expect(pill()).toBeNull();
    expect(screen.getByLabelText('Select')).toHaveAttribute('aria-pressed', 'false');
  });

  it('never starts under the editor, and a pick already on ends when the editor opens', async () => {
    const { frame } = makeFrame();
    const { rerender } = render(layer(frame, { railOpen: true, pickOnOpen: false }));
    await flush();
    expect(pill()).toBeNull();
    // …but the tool still works there, explicitly.
    fireEvent.click(screen.getByLabelText('Select'));
    expect(pill()).not.toBeNull();

    rerender(layer(frame, { railOpen: true, pickOnOpen: true }));
    await flush();
    expect(pill()).not.toBeNull();
    rerender(layer(frame, { railOpen: true, pickOnOpen: false }));
    await flush();
    expect(pill()).toBeNull();
  });

  it('a composer arriving by another route ends the pick', async () => {
    const { frame } = makeFrame();
    const { rerender } = render(layer(frame, { railOpen: true }));
    await flush();
    expect(pill()).not.toBeNull();
    rerender(layer(frame, {
      railOpen: true,
      initialSelection: { kind: 'text' as const, path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] },
    }));
    await flush();
    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(pill()).toBeNull();
  });
});

describe('drawing an area from the rail', () => {
  const pill = () => screen.queryByRole('status', { name: 'Select tool active' });
  const last = (postMessage: ReturnType<typeof vi.fn>) =>
    postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE).at(-1);
  const AREA = { v: 1 as const, kind: 'area' as const, box: { x: 0.2, y: 0.05, w: 0.5, h: 0.4 } };
  const PICKED_AREA = {
    kind: 'element' as const, path: '2', nodeId: 'node-2', tag: 'section', rect: { x: 5, y: 6, width: 400, height: 200 },
    className: 'max-w-2xl', style: '', ancestors: [], range: AREA,
  };

  it('Select toggles node and text selection', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    const tool = screen.getByLabelText('Select');
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Draw an area to comment on')).toBeNull();
    expect(last(postMessage)).toMatchObject({ pick: 'block' });
    expect(pill()).toHaveTextContent(/click a block or highlight text/i);
    fireEvent.click(tool);
    expect(last(postMessage)).toMatchObject({ pick: null });
    fireEvent.click(tool);
    expect(last(postMessage)).toMatchObject({ pick: 'block' });
  });

  it('an area pick opens the composer on its anchor and saves the area as the range, with no quote', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: PICKED_AREA });
    expect(screen.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
    expect(last(postMessage)).toMatchObject({ pick: null, selectedPath: '2' });
    // The frame re-reports the SAME node's geometry on scroll, without the range; the area must survive it.
    await fromFrame(contentWindow, { type: STORY_SELECTION_MESSAGE, nonce: NONCE, selection: { ...PICKED_AREA, range: undefined, rect: { x: 5, y: 60, width: 400, height: 200 } } });
    fireEvent.change(screen.getByLabelText('Annotation comment'), { target: { value: 'this whole region' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');
    const body = JSON.parse(String(create!.init!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ path: '2', node_id: 'node-2', body: 'this whole region', range: AREA });
    expect(body).not.toHaveProperty('quote');
  });

  it('hands an area thread\'s range to the frame with its pin', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: false, liveAnnotations: [{ ...ANN, id: 'ann_area', range: AREA }] }));
    await flush();
    // The live list posts its pins the moment it lands (the seed fetch, resolving
    // after it in this harness, then posts its own — the next live frame wins).
    const pins = postMessage.mock.calls.map((call) => call[0])
      .filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE)
      .flatMap((message) => message.pins as Array<{ id: string; range: unknown }>);
    expect(pins).toContainEqual(expect.objectContaining({ id: 'ann_area', range: AREA }));
  });
});

describe('the rail under the bar', () => {
  it('starts at the offset the page gives it and leaves the frame\'s scrollbar visible', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, topOffset: 44, rightInset: 15 }));
    await flush();
    const rail = screen.getByLabelText('Annotation sidebar');
    expect(rail.style.top).toBe('44px');
    expect(rail.style.right).toBe('15px');
  });
});

it('does not replay unchanged area state in response to a geometry-only echo', async () => {
  const {frame,contentWindow,postMessage}=makeFrame();
  const selected={kind:'element' as const,path:'1',nodeId:'node-1',tag:'section',rect:{x:5,y:6,width:200,height:40},className:'',style:'',ancestors:[],range:{v:1 as const,kind:'area' as const,box:{x:0.1,y:0.1,w:0.5,h:0.5}}};
  render(layer(frame,{railOpen:true,initialSelection:selected}));await flush();
  postMessage.mockClear();
  const {range: _range,...geometry}=selected;
  await fromFrame(contentWindow,{type:STORY_SELECTION_MESSAGE,nonce:NONCE,selection:geometry});await flush();
  expect(postMessage.mock.calls.filter(([message])=>message.type===STORY_ANNOTATIONS_MESSAGE)).toHaveLength(0);
});
