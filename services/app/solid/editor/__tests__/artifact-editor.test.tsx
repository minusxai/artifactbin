/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import ArtifactEditor from '../ArtifactEditor';

/** The gate into editing: no write authority means the locked card, never the editor. */
it('shows the locked card when this browser may not write, and lets the visitor leave', async () => {
  const onExit = vi.fn();
  const backend = fakeBackend({}, { load: vi.fn(async () => null) });
  render(() => <ArtifactEditor id="doc12345" backend={backend} onExit={onExit} runtimeRef={{ current: null }} sessionNonce="n" />);
  expect(await screen.findByRole('heading', { name: 'this document is locked' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'log in' })).toHaveAttribute('href', expect.stringContaining('/login?callbackUrl='));
  expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  fireEvent.click(screen.getByRole('button', { name: 'View this document without editing' }));
  expect(onExit).toHaveBeenCalledTimes(1);
});

it('says it is loading until the document arrives', () => {
  const backend = fakeBackend({}, { load: vi.fn(() => new Promise<never>(() => {})) });
  render(() => <ArtifactEditor id="doc12345" backend={backend} onExit={() => {}} runtimeRef={{ current: null }} sessionNonce="n" />);
  expect(screen.getByRole('status')).toHaveTextContent('loading…');
});
