/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import ArtifactEditor from '../ArtifactEditor';

// The in-place editor is its own tests' subject; here only whether it is mounted, and on what.
vi.mock('../InPlaceEditor', () => ({ default: (props: { art: { markup?: string | null } }) => <p>editing {props.art.markup}</p> }));

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

/**
 * A seeded editor was admitted by the editor door, which answers a writer alone: reading the whole document again
 * just to ask the same question downloaded it twice (the document's graph and source, 20 times its size).
 */
it('opens on its seed without reading the document again', async () => {
  const load = vi.fn(async () => null);
  const backend = fakeBackend({}, { load });
  const seed = { id: 'doc12345', version: 3, edit_id: 'e3', title: null, theme: null, template: null, colorMode: null, markup: '<p id="a">Hi</p>' };
  render(() => <ArtifactEditor id="doc12345" backend={backend} seed={seed} onExit={() => {}} runtimeRef={{ current: null }} sessionNonce="n" />);
  expect(await screen.findByText(/^editing /)).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'this document is locked' })).toBeNull();
});

/** A seed prefetched minutes ago may have outlived the access it was admitted under: the same refusal UI as the head read drew. */
it('draws the locked card when a seeded editor is no longer admitted, and stays open when it is', async () => {
  const seed = { id: 'doc12345', version: 3, edit_id: 'e3', title: null, theme: null, template: null, colorMode: null, markup: '<p id="a">Hi</p>' };
  const onExit = vi.fn();
  const load = vi.fn(async () => null);
  const refused = render(() => <ArtifactEditor id="doc12345" backend={fakeBackend({}, { load })} seed={seed} admitted={async () => false} onExit={onExit} runtimeRef={{ current: null }} sessionNonce="n" />);
  expect(await screen.findByRole('heading', { name: 'this document is locked' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'log in' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View this document without editing' }));
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(load).not.toHaveBeenCalled();
  refused.unmount();
  const admitted = vi.fn(async () => true);
  render(() => <ArtifactEditor id="doc12345" backend={fakeBackend({}, { load })} seed={seed} admitted={admitted} onExit={() => {}} runtimeRef={{ current: null }} sessionNonce="n" />);
  expect(await screen.findByText(/^editing /)).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(admitted).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: 'this document is locked' })).toBeNull();
});
