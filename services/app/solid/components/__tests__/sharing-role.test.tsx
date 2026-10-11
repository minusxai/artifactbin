/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import ShareLink from '../ShareLink';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('offers only the selected recipient role options while editing a share', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ visibility: 'private', linkRole: 'viewer', canPrivate: true, shares: [{ email: 'one@example.com', role: 'viewer' }, { email: 'two@example.com', role: 'viewer' }] })));
  render(() => <ShareLink artifactId="dataset" title="Dataset" format="dataset" editable />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const recipient = await screen.findByRole('button', { name: 'Role for two@example.com' });
  fireEvent.click(recipient);
  expect(screen.getAllByRole('option', { name: 'can edit' })).toHaveLength(1);
});

const sharing = (extra: object = {}) => ({ visibility: 'private', linkRole: 'viewer', canPrivate: true, shares: [{ email: 'one@example.com', role: 'viewer' }], ...extra });
const putBodies = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init!.body)));

it('opens a modal named Sharing over the artifact title and sends a recipient role change as one PUT', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'PUT' ? sharing({ shares: [{ email: 'one@example.com', role: 'editor' }] }) : sharing())));
  render(() => <ShareLink artifactId="doc1" title="Quarterly plan" format="markup" editable startOpen />);
  const dialog = await screen.findByRole('dialog', { name: 'Sharing' });
  expect(dialog).toHaveAccessibleDescription('Quarterly plan');
  fireEvent.click(await screen.findByRole('button', { name: 'Role for one@example.com' }));
  fireEvent.click(screen.getByRole('option', { name: 'can edit' }));
  await waitFor(() => expect(putBodies()).toEqual([{ shares: [{ email: 'one@example.com', role: 'editor' }] }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Role for one@example.com' })).toHaveTextContent('can edit'));
});

it('pins the chosen visibility and only sends a change for another one', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(sharing({ visibility: init?.method === 'PUT' ? 'public' : 'private' }))));
  render(() => <ShareLink artifactId="doc1" title="Plan" format="markup" editable startOpen />);
  const priv = await screen.findByRole('button', { name: 'Make private' });
  await waitFor(() => expect(priv).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('button', { name: 'Make public' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(putBodies()).toEqual([{ visibility: 'public' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make public' })).toHaveAttribute('aria-pressed', 'true'));
});

it('asks before making a dataset that documents write to read-only, and keeps writes when the owner backs out', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(sharing({ access: init?.method === 'PUT' ? 'read' : 'readwrite', writtenBy: [{ id: 'doc9', title: 'Ledger', mutations: ['add'] }] }))));
  render(() => <ShareLink artifactId="data1" title="Ledger rows" format="dataset" editable startOpen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Make read-only' }));
  const confirm = await screen.findByRole('dialog', { name: 'Make this dataset read-only?' });
  expect(confirm).toHaveAccessibleDescription(expect.stringContaining('stop working until writes are enabled again'));
  fireEvent.click(screen.getByRole('button', { name: 'Keep writable' }));
  expect(screen.queryByRole('dialog', { name: 'Make this dataset read-only?' })).toBeNull();
  expect(putBodies()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Make read-only' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm read-only' }));
  await waitFor(() => expect(putBodies()).toEqual([{ access: 'read' }]));
});

it('closes through its Close button and reports it to the opener', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(sharing())));
  const onClose = vi.fn();
  render(() => <ShareLink artifactId="doc1" title="Plan" format="markup" editable startOpen onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close sharing' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();
});
