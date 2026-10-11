/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
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
