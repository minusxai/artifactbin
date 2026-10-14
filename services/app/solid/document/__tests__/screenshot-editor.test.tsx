/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { fireEvent, render } from '../../__tests__/helpers';
import { ScreenshotEditor, type ScreenshotDrawing } from '../ScreenshotEditor';

const image = { blob: new Blob(), width: 100, height: 50, rect: { x: 0, y: 0, width: 100, height: 50 }, viewport: { width: 100, height: 50 }, capturedAt: '2026-09-29T12:00:00.000Z', method: 'canvas' as const };

it('embeds brush controls without a separate dialog or completion step', () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const retake = vi.fn();
  const view = render(() => <ScreenshotEditor image={image} initialStrokes={[]} exportRef={{ current: null }} busy={false} onRetake={retake} />);
  expect(view.getByRole('radiogroup', { name: 'Brush color' })).toBeTruthy();
  expect(view.getByRole('radio', { name: 'Blue' })).toBeTruthy();
  expect(view.queryByRole('dialog')).toBeNull();
  expect(view.queryByRole('button', { name: 'Use screenshot' })).toBeNull();
  fireEvent.change(view.getByLabelText('Brush thickness'), { target: { value: '8' } });
  expect(view.getByLabelText('Brush thickness')).toHaveValue('8');
  expect(view.getByRole('button', { name: 'Undo stroke' })).toBeDisabled();
  fireEvent.click(view.getByRole('button', { name: 'Retake screenshot' }));
  expect(retake).toHaveBeenCalledOnce();
  view.unmount(); vi.restoreAllMocks();
});

it('exports a drawing on demand and invalidates the cached image after undo', async () => {
  let loaded: () => void = () => {};
  vi.stubGlobal('Image', class { set onload(value: () => void) { loaded = value; } set src(_value: string) {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${btoa('drawing')}`);
  const idleEncode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
  const exportRef: { current: (() => Promise<ScreenshotDrawing>) | null } = { current: null };
  const view = render(() => <ScreenshotEditor image={image} initialStrokes={[{ color: '#ef4444', width: 3, points: [[10, 10], [20, 20]] }]} exportRef={exportRef} busy={false} onRetake={() => {}} />);
  loaded();
  const first = await exportRef.current!();
  expect(first.strokes).toHaveLength(1);
  expect(first.preview.type).toBe('image/png');
  expect(await first.preview.text()).toBe('drawing');
  // Never Chromium's idle-scheduled encoder (lib/capture/png).
  expect(idleEncode).not.toHaveBeenCalled();
  expect(await exportRef.current!()).toBe(first);
  expect(encode).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: 'Undo stroke' }));
  const second = await exportRef.current!();
  expect(second.strokes).toEqual([]);
  expect(second.preview).not.toBe(first.preview);
  view.unmount(); expect(exportRef.current).toBeNull();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('draws with the chosen swatch, a typed custom colour and the slider width, and stores those exact values', async () => {
  let loaded: () => void = () => {};
  vi.stubGlobal('Image', class { set onload(value: () => void) { loaded = value; } set src(_value: string) {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${btoa('drawing')}`);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
  class TestPointerEvent extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  const exportRef: { current: (() => Promise<ScreenshotDrawing>) | null } = { current: null };
  const view = render(() => <ScreenshotEditor image={image} initialStrokes={[]} exportRef={exportRef} busy={false} />);
  loaded();
  const canvas = view.getByLabelText('Screenshot drawing canvas');
  const draw = (x: number) => { fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: x, clientY: 10 }); fireEvent.pointerMove(canvas, { pointerId: 1, clientX: x + 20, clientY: 20 }); fireEvent.pointerUp(canvas, { pointerId: 1 }); };
  // The palette is a radio group: exactly one swatch is checked, and the first is the default.
  expect(view.getByRole('radio', { name: 'Red' })).toBeChecked();
  fireEvent.click(view.getByRole('radio', { name: 'Blue' }));
  expect(view.getByRole('radio', { name: 'Blue' })).toBeChecked();
  expect(view.getByRole('radio', { name: 'Red' })).not.toBeChecked();
  fireEvent.input(view.getByRole('slider', { name: 'Brush thickness' }), { target: { value: '8' } });
  expect(view.getByText('8 px')).toBeTruthy();
  draw(10);
  // A custom colour is typed as hex; a shorthand expands to #rrggbb.
  fireEvent.input(view.getByLabelText('Custom brush color'), { target: { value: '#0f0' } });
  draw(40);
  const { strokes } = await exportRef.current!();
  expect(strokes.map(stroke => stroke.color)).toEqual(['#3b82f6', '#00ff00']);
  expect(strokes.map(stroke => stroke.width)).toEqual([8, 8]);
  view.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
