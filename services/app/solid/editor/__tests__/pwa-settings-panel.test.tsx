/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { readPwaSettings } from '@/lib/document/pwa-settings';
import { PwaSettingsPanel } from '../PwaSettingsPanel';

const SOURCE = '<p id="one">Keep me</p>';

it('opens the hidden file input from its button and stores the uploaded icon', async () => {
  const change = vi.fn();
  const onUpload = vi.fn(async () => ({ ok: true as const, image: { id: 'icon123', rawUrl: '/a/icon123/raw' } }));
  render(() => <PwaSettingsPanel id="Abc123" title="Doc" source={SOURCE} onChange={change} onUpload={onUpload as never} />);
  const input = screen.getByLabelText('Upload app icon') as HTMLInputElement;
  expect(input).toHaveAttribute('hidden');
  const open = vi.spyOn(input, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Choose icon…' }));
  expect(open).toHaveBeenCalledTimes(1);

  const file = new File(['x'], 'icon.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  await vi.waitFor(() => expect(change).toHaveBeenCalled());
  expect(onUpload).toHaveBeenCalledWith(file);
  expect(readPwaSettings(change.mock.lastCall![0]).icon).toBe('icon123');
});

it('reports a refused upload as an alert and keeps the source untouched', async () => {
  const change = vi.fn();
  const onUpload = vi.fn(async () => ({ ok: false as const, error: 'That image is too large.' }));
  render(() => <PwaSettingsPanel id="Abc123" title="Doc" source={SOURCE} onChange={change} onUpload={onUpload as never} />);
  const input = screen.getByLabelText('Upload app icon') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'big.png', { type: 'image/png' })], configurable: true });
  fireEvent.change(input);
  expect(await screen.findByRole('alert')).toHaveTextContent('That image is too large.');
  expect(change).not.toHaveBeenCalled();
});

afterEach(() => vi.useRealTimers());

it('draws the theme and background colors as color fields that write once the color settles', () => {
  vi.useFakeTimers();
  const change = vi.fn();
  render(() => <PwaSettingsPanel id="Abc123" title="Doc" source={SOURCE} onChange={change} onUpload={vi.fn()} />);
  const theme = screen.getByRole('textbox', { name: 'Theme color' });
  expect(theme).toHaveValue('#ffffff');
  expect(screen.getByRole('textbox', { name: 'Background color' })).toHaveValue('#ffffff');
  expect(screen.getByText('App title bar and browser toolbar, where supported.')).toBeInTheDocument();
  // A drag over the picker fires many input events: one write, for the last color.
  for (const hex of ['#111111', '#222222', '#336699']) fireEvent.input(screen.getByLabelText('Theme color picker'), { target: { value: hex } });
  expect(theme).toHaveValue('#336699');
  expect(change).not.toHaveBeenCalled();
  vi.advanceTimersByTime(400);
  expect(change).toHaveBeenCalledTimes(1);
  expect(readPwaSettings(change.mock.lastCall![0])).toEqual({ themeColor: '#336699' });
});

it('keeps a pending color when the panel closes before it settles', () => {
  vi.useFakeTimers();
  const change = vi.fn();
  const view = render(() => <PwaSettingsPanel id="Abc123" title="Doc" source={SOURCE} onChange={change} onUpload={vi.fn()} />);
  fireEvent.input(screen.getByRole('textbox', { name: 'Background color' }), { target: { value: '#102030' } });
  expect(change).not.toHaveBeenCalled();
  view.unmount();
  expect(readPwaSettings(change.mock.lastCall![0])).toEqual({ backgroundColor: '#102030' });
});
