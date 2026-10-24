/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { mountPortableChrome } from '../browser-portable-chrome';
import type { PortableChromeOptions, PortableChromeState } from '@/lib/html-runtime/portable-chrome-contract';
import { cleanup } from '@/solid/__tests__/helpers';

const disposals: Array<() => void> = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); cleanup(); document.documentElement.removeAttribute('data-af-dark'); vi.restoreAllMocks(); });
function mount(overrides: Partial<PortableChromeOptions> = {}) {
  const options: PortableChromeOptions = {
    win: window, stylesheet: '', title: 'Local document', kind: 'linked', state: 'offline',
    identity: { platformOrigin: 'https://platform.example', artifactId: 'example', baseRevision: '3', sourceDigest: 'digest' },
    onConnect: vi.fn(), onDisconnect: vi.fn(), onStayOffline: vi.fn(), onSave: vi.fn(), onPublish: vi.fn(), onOpenHosted: vi.fn(), ...overrides,
  };
  const chrome = mountPortableChrome(options);
  disposals.push(chrome.dispose);
  const host = document.querySelector('[data-af-local-chrome]')!;
  const root = host.shadowRoot!;
  return { chrome, options, root, ui: within(root as unknown as HTMLElement) };
}

it.each<PortableChromeState>(['offline', 'connecting', 'connected', 'signin-required', 'permission-required', 'blocked', 'stale', 'unavailable', 'unknown-outcome'])('keeps Save HTML available while %s without starting a connection', (state) => {
  const { chrome, ui, options } = mount();
  chrome.update({ state });
  expect(ui.getByRole('button', { name: 'Save HTML' })).toBeEnabled();
  expect(options.onConnect).not.toHaveBeenCalled();
  expect(options.onPublish).not.toHaveBeenCalled();
  expect(options.onSave).not.toHaveBeenCalled();
});

it('saves without private state by default and includes it only after the explicit choice', async () => {
  const { ui, options } = mount();
  fireEvent.click(ui.getByRole('button', { name: 'Save HTML' }));
  expect(options.onSave).toHaveBeenLastCalledWith({ includePrivateState: false });
  await Promise.resolve();
  fireEvent.click(ui.getByRole('button', { name: 'Local file actions' }));
  const choice = ui.getByRole('menuitemcheckbox', { name: 'Include private filters and drafts' });
  expect(choice).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(choice);
  fireEvent.click(ui.getByRole('button', { name: 'Save HTML' }));
  expect(options.onSave).toHaveBeenLastCalledWith({ includePrivateState: true });
});

it('offers Publish for an unpublished file and never chooses a remote server automatically', () => {
  const { ui, options } = mount({ kind: 'unpublished', identity: undefined });
  expect(ui.queryByRole('button', { name: 'Connect original' })).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: 'Publish' }));
  const dialog = ui.getByRole('dialog', { name: 'Publish local file' });
  expect(options.onPublish).not.toHaveBeenCalled();
  fireEvent.input(within(dialog).getByRole('textbox', { name: 'Platform URL' }), { target: { value: 'https://platform.example' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  expect(options.onPublish).toHaveBeenCalledWith({ platformOrigin: 'https://platform.example' });
  expect(options.onConnect).not.toHaveBeenCalled();
});

it('connects only the linked original and keeps local controls after disconnect or Stay offline', () => {
  const { chrome, ui, options } = mount();
  fireEvent.click(ui.getByRole('button', { name: 'Connect original' }));
  expect(options.onConnect).toHaveBeenCalledOnce();
  expect(ui.queryByRole('textbox')).toBeNull();
  chrome.update({ state: 'connected' });
  fireEvent.click(ui.getByRole('button', { name: 'Local file actions' }));
  fireEvent.click(ui.getByRole('menuitem', { name: 'Disconnect' }));
  expect(options.onDisconnect).toHaveBeenCalledOnce();
  chrome.update({ state: 'signin-required' });
  fireEvent.click(ui.getByRole('button', { name: 'Local file actions' }));
  fireEvent.click(ui.getByRole('menuitem', { name: 'Stay offline' }));
  expect(options.onStayOffline).toHaveBeenCalledOnce();
  chrome.update({ state: 'offline', title: 'Renamed local document', previewStatus: { changed: true, connected: false } });
  expect(ui.getByRole('button', { name: 'Save HTML' })).toBeEnabled();
  expect(ui.getByRole('status')).toHaveTextContent('File changed on disk');
});

it('removes its host and portalled menu when disposed', () => {
  const { chrome, ui } = mount();
  fireEvent.click(ui.getByRole('button', { name: 'Local file actions' }));
  expect(ui.getByRole('menu')).toBeInTheDocument();
  chrome.dispose();
  expect(document.querySelector('[data-af-local-chrome]')).toBeNull();
});

it('switches a published file to linked controls and displays explicit source feedback', () => {
  const { chrome, ui } = mount({ kind: 'unpublished', identity: undefined });
  chrome.update({ state: 'offline', kind: 'linked', identity: { platformOrigin: 'https://platform.example', artifactId: 'published', baseRevision: '1', sourceDigest: 'digest' }, notice: 'Save linked HTML to keep this connection.', sourceStatus: 'Current file not verified' });
  expect(ui.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(ui.getByRole('button', { name: 'Connect original' })).toBeEnabled();
  expect(ui.getByRole('status')).toHaveTextContent('Save linked HTML to keep this connection.');
  expect(ui.getByRole('status')).toHaveTextContent('Current file not verified');
});

it('rejects a publish destination with a path without calling the publication flow', () => {
  const { ui, options } = mount({ kind: 'unpublished', identity: undefined });
  fireEvent.click(ui.getByRole('button', { name: 'Publish' }));
  const dialog = ui.getByRole('dialog', { name: 'Publish local file' });
  fireEvent.input(within(dialog).getByRole('textbox', { name: 'Platform URL' }), { target: { value: 'https://platform.example/path' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
  expect(within(dialog).getByRole('textbox', { name: 'Platform URL' })).toHaveAttribute('aria-invalid', 'true');
  expect(options.onPublish).not.toHaveBeenCalled();
});

it('offers explicit dirty-safe reload when the file changed on disk without claiming Save preserves it', () => {
  const onReloadPreview = vi.fn();
  const { chrome, ui } = mount({ onReloadPreview });
  chrome.update({ state: 'offline', previewStatus: { changed: true, connected: true }, notice: 'Save HTML keeps a local copy.' });
  expect(ui.getByRole('status')).toHaveTextContent('File changed on disk');
  expect(ui.getByRole('status')).not.toHaveTextContent('Save HTML');
  expect(onReloadPreview).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole('button', { name: 'Reload file' }));
  expect(onReloadPreview).toHaveBeenCalledOnce();
});

it.each(['unpublished', 'linked'] as const)('provides local Light and Dark choices for an offline %s file', (kind) => {
  const onMode = vi.fn();
  const { ui } = mount({ kind, mode: 'light', onMode });
  fireEvent.click(ui.getByRole('button', { name: 'Local file actions' }));
  expect(ui.getByRole('menuitemcheckbox', { name: 'Light mode' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(ui.getByRole('menuitemcheckbox', { name: 'Dark mode' }));
  expect(document.documentElement).toHaveAttribute('data-af-dark');
  expect(onMode).toHaveBeenLastCalledWith('dark');
  fireEvent.click(ui.getByRole('button', { name: 'Local file actions' }));
  expect(ui.getByRole('menuitemcheckbox', { name: 'Dark mode' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(ui.getByRole('menuitemcheckbox', { name: 'Light mode' }));
  expect(document.documentElement).not.toHaveAttribute('data-af-dark');
  expect(onMode).toHaveBeenLastCalledWith('light');
});

it.each([
  [{ dirty: true }, 'Local dataset edits are unsaved'],
  [{ conflict: true }, 'Local dataset edits conflict with the file on disk'],
] as const)('retains dataset recovery when disk revision already matches: %o', (flags, message) => {
  const onReloadPreview = vi.fn();
  const { chrome, ui } = mount({ onReloadPreview });
  chrome.update({ state: 'offline', previewStatus: { changed: false, connected: true, ...flags } });
  expect(ui.getByRole('status')).toHaveTextContent(message);
  fireEvent.click(ui.getByRole('button', { name: 'Reload file' }));
  expect(onReloadPreview).toHaveBeenCalledOnce();
});

it('shows the exact actionable preview error as text', () => {
  const { chrome, ui } = mount();
  const error = 'Preview file exceeds 32 MiB. Use a smaller file. <strong>Not markup</strong>';
  chrome.update({ state: 'offline', previewStatus: { changed: false, connected: false, error } });
  expect(ui.getByRole('status')).toHaveTextContent(error);
  expect(ui.getByRole('status').querySelector('strong')).toBeNull();
});
