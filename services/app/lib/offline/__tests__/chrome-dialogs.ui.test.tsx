/* @jsxImportSource solid-js */
/**
 * The offline file's three modal questions, drawn by solid/ui/Dialog: the names the gate (gate-offline-file) looks
 * for, who may dismiss each, and what each reports. The real file:// run is the gate's.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { fireEvent, screen } from '@testing-library/dom';
import '@testing-library/jest-dom/vitest';
import { TrustedUi } from '@/solid/components/TrustedUi';
import { ConnectDialog, NameDialog, RestoreDialog } from '../chrome-dialogs';

let dispose: (() => void) | undefined;
const mount = (ui: () => any) => { const host = document.body.appendChild(document.createElement('div')); dispose = render(ui, host); };
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });

it('asks to restore unsaved changes as an alertdialog only Restore or Discard can answer', () => {
  const answer = vi.fn();
  mount(() => <RestoreDialog savedAt="2026-10-01T10:00:00Z" onAnswer={answer} />);
  const dialog = screen.getByRole('alertdialog', { name: 'Restore unsaved changes' });
  expect(dialog).toHaveAccessibleDescription(/Restore unsaved changes from/);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(answer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(answer).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  expect(answer).toHaveBeenLastCalledWith(true);
});

it('draws the restore prompt in the trusted overlay the offline file mounts it in', () => {
  mount(() => <TrustedUi overlay layer="modal"><RestoreDialog savedAt={0} onAnswer={() => {}} /></TrustedUi>);
  const host = document.querySelector('[data-trusted-ui]')!;
  expect(host.shadowRoot!.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(document.body.querySelector(':scope > [role="alertdialog"]')).toBeNull();
});

it('asks for a name: Save reports what was typed, Cancel and Escape report null', () => {
  const answer = vi.fn();
  mount(() => <NameDialog onAnswer={answer} />);
  const dialog = screen.getByRole('dialog', { name: 'What should we call you?' });
  const name = screen.getByRole('textbox', { name: 'Your name' });
  expect(document.activeElement).toBe(name);
  fireEvent.input(name, { target: { value: 'Asha' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(answer).toHaveBeenLastCalledWith('Asha');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(answer).toHaveBeenLastCalledWith(null);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(answer).toHaveBeenCalledTimes(3);
  expect(answer).toHaveBeenLastCalledWith(null);
});

it('connects to a server: the address, the connection state, and Close that cancels', () => {
  const [address, setAddress] = createSignal('http://localhost:7474');
  const [connecting, setConnecting] = createSignal(false);
  const onConnect = vi.fn(() => setConnecting(true));
  const onClose = vi.fn();
  mount(() => <ConnectDialog address={address()} onAddress={setAddress} connecting={connecting()} status={connecting() ? 'Opening the server…' : ''} error="" openedUrl="" onConnect={onConnect} onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'Connect to server' });
  const input = screen.getByRole('textbox', { name: 'Server address' });
  expect(input).toHaveValue('http://localhost:7474');
  expect(input).toHaveAccessibleDescription(/HTTPS address of hosted artifactbin/);
  fireEvent.input(input, { target: { value: 'https://app.example' } });
  expect(address()).toBe('https://app.example');
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  expect(onConnect).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  expect(input).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Opening the server…');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel connection' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('names a refusal as an alert and links the server editor once opened', () => {
  mount(() => <ConnectDialog address="x" onAddress={() => {}} connecting={false} status="" error="Could not open the server." openedUrl="http://localhost:7474/edit" onConnect={() => {}} onClose={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not open the server.');
  expect(screen.getByRole('link', { name: 'Open server editor' })).toHaveAttribute('href', 'http://localhost:7474/edit');
  expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
});
