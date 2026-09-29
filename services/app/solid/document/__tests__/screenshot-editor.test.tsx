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
  expect(view.getByLabelText('Brush color')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Blue brush' })).toBeTruthy();
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
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['drawing'], { type: 'image/png' })));
  const exportRef: { current: (() => Promise<ScreenshotDrawing>) | null } = { current: null };
  const view = render(() => <ScreenshotEditor image={image} initialStrokes={[{ color: '#ef4444', width: 3, points: [[10, 10], [20, 20]] }]} exportRef={exportRef} busy={false} onRetake={() => {}} />);
  loaded();
  const first = await exportRef.current!();
  expect(first.strokes).toHaveLength(1);
  expect(await exportRef.current!()).toBe(first);
  expect(encode).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: 'Undo stroke' }));
  const second = await exportRef.current!();
  expect(second.strokes).toEqual([]);
  expect(second.preview).not.toBe(first.preview);
  view.unmount(); expect(exportRef.current).toBeNull();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
