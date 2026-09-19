import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InstallArtifact, InstallArtifactLink } from '../InstallArtifact';
import { captureInstallPrompt } from '@/lib/pwa-install';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

it('uses a full navigation to the artifact-specific install page without copying query credentials', () => {
  window.history.replaceState(null, '', '/a/Abc123?key=secret&version=1');
  render(<InstallArtifactLink id="Abc123" />);
  expect(screen.getByRole('link', { name: 'Install app' }).getAttribute('href')).toBe('/a/Abc123/app/?install=1');
});

it('offers manual instructions then consumes a native prompt only on a click', async () => {
  window.history.replaceState(null, '', '/a/Abc123/app/?install=1');
  const dispose = captureInstallPrompt(window);
  render(<InstallArtifact id="Abc123" title="Budget" />);
  expect(screen.getByRole('dialog').textContent).toContain('Add to Home Screen');
  const prompt = vi.fn().mockResolvedValue({ outcome: 'dismissed' });
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt });
  act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(prompt).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install app' })); });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  dispose();
});

it('does not offer another artifact’s captured prompt after SPA navigation', () => {
  window.history.replaceState(null, '', '/a/Abc123/app/?install=1');
  const dispose = captureInstallPrompt(window);
  const prompt = vi.fn();
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt });
  window.dispatchEvent(event);
  window.history.replaceState(null, '', '/a/Xyz456/app/?install=1');
  render(<InstallArtifact id="Xyz456" title="Other" />);
  expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  expect(screen.getByText('Done')).toBeTruthy();
  dispose();
});
