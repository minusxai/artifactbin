/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { InstallArtifact, InstallArtifactLink } from '../InstallArtifact';
import { captureInstallPrompt, currentInstall } from '@/lib/pwa-install';
import { PwaSettingsPanel, PwaSharingSetting } from '../../editor/PwaSettingsPanel';
import { readPwaSettings } from '@/lib/story/reader/pwa-settings';

afterEach(() => window.history.replaceState(null, '', '/'));
it('links to a clean stable install page and prompts only on click', async () => {
  window.history.replaceState(null, '', '/a/Abc123/app/?install=1&key=secret');
  const dispose = captureInstallPrompt(window);
  render(() => <><InstallArtifactLink id="Abc123" /><InstallArtifact id="Abc123" title="Budget" /></>);
  expect(screen.getByRole('link', { name: 'Install app' }).getAttribute('href')).toBe('/a/Abc123/app/?install=1');
  expect(screen.getByRole('dialog').textContent).toContain('Add to Home Screen');
  const prompt = vi.fn().mockResolvedValue({ outcome: 'dismissed' });
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(prompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
  await Promise.resolve();
  expect(prompt).toHaveBeenCalledTimes(1);
  dispose();
});
it('does not use a prompt belonging to another artifact', () => {
  window.history.replaceState(null, '', '/a/Abc123/app/');
  const dispose = captureInstallPrompt(window);
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() }));
  window.history.replaceState(null, '', '/a/Xyz456/app/?install=1');
  render(() => <InstallArtifact id="Xyz456" title="Other" />);
  expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  dispose();
});
it('edits separate PWA metadata through the editor source callback', () => {
  const change = vi.fn();
  render(() => <PwaSettingsPanel id="Abc123" title="Document title" source={'<p id="one">Keep me</p>'} onChange={change} onUpload={vi.fn()} />);
  fireEvent.input(screen.getByLabelText('App name'), { target: { value: 'My app' } });
  fireEvent.blur(screen.getByLabelText('App name'));
  expect(readPwaSettings(change.mock.lastCall![0])).toEqual({ name: 'My app' });
  expect(change.mock.lastCall![0]).toContain('<p id="one">Keep me</p>');
  expect(screen.getByLabelText('Upload app icon')).toBeTruthy();
});

it('waits for editor saves and stays put if saving fails', async () => {
  const save = vi.fn().mockResolvedValue(false);
  render(() => <InstallArtifactLink id="Abc123" beforeNavigate={save} />);
  fireEvent.click(screen.getByRole('link', { name: 'Install app' }));
  expect(save).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(window.location.pathname).toBe('/');
});

it('captures a regular artifact prompt without suppressing the browser promotion', () => {
  window.history.replaceState(null, '', '/@owner/Abc123-report');
  const link = document.createElement('link');
  link.rel = 'manifest'; link.href = '/a/Abc123/app/manifest.webmanifest'; link.setAttribute('data-mx-pwa', '');
  document.head.append(link);
  const dispose = captureInstallPrompt(window);
  const prompt = vi.fn();
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(currentInstall()?.path).toBe('/a/Abc123/app/');
  dispose(); link.remove();
});

it('offers an off-by-default Sharing switch that preserves existing PWA details', () => {
  const change = vi.fn();
  render(() => <PwaSharingSetting source={'<Helmet><meta name="artifactbin:pwa-name" content="Saved name" /></Helmet><p>Hello</p>'} onChange={change} />);
  const toggle = screen.getByRole('switch', { name: 'Allow installation as a PWA' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(readPwaSettings(change.mock.lastCall![0])).toEqual({ enabled: true, name: 'Saved name' });
});
