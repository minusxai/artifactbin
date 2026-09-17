import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { lazyPage } from '../lazy-page';

it('preloads code once and adopts that same module when mounted', async () => {
  const load = vi.fn().mockResolvedValue({ default: () => <div aria-label="Preloaded destination" /> });
  const Page = lazyPage(load);
  await Promise.all([Page.preload(), Page.preload()]);
  render(<Page />);
  await screen.findByLabelText('Preloaded destination');
  expect(load).toHaveBeenCalledTimes(1);
});

it('keeps surrounding chrome while pending and retries a failed chunk only on request', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: () => <div aria-label="Loaded destination" /> });
  const Page = lazyPage(load);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<><header aria-label="Persistent chrome" /><Page /></>);
  const chrome = screen.getByLabelText('Persistent chrome');
  await screen.findByLabelText('Retry loading page');
  expect(screen.getByLabelText('Reload app')).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByLabelText('Retry loading page'));
  await screen.findByLabelText('Loaded destination');
  expect(screen.getByLabelText('Persistent chrome')).toBe(chrome);
  expect(load).toHaveBeenCalledTimes(2);
  error.mockRestore();
});

it('preserves the loaded component lifetime when route props change', async () => {
  let mounts = 0;
  const { useState } = await import('react');
  const Page = lazyPage(async () => ({ default: ({ label }: { label: string }) => {
    const [identity] = useState(() => ++mounts);
    return <div aria-label="Destination">{label}:{identity}</div>;
  } }));
  const view = render(<Page label="alias" />);
  await screen.findByLabelText('Destination');
  await act(async () => view.rerender(<Page label="canonical" />));
  expect(screen.getByLabelText('Destination').textContent).toBe('canonical:1');
});
