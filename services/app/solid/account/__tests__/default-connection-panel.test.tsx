/* @jsxImportSource solid-js */
/** The settings page's default connection row: shown fields only, "Test connection" and its two outcomes. */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DefaultConnectionPanel } from '../DefaultConnectionPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const serve = (status: unknown, test: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
  String(url).endsWith('/test') && init?.method === 'POST' ? Response.json(test) : Response.json(status)));

it('shows the connector and its shown fields, and tests the connection', async () => {
  serve({ configured: true, connector: 'postgres', label: 'PostgreSQL', fields: { host: 'db.example.com', port: 5432, database: 'shop' } }, { ok: true, latencyMs: 12 });
  render(() => <DefaultConnectionPanel />);
  expect(await screen.findByText('PostgreSQL')).toBeInTheDocument();
  expect(screen.getByText('db.example.com')).toBeInTheDocument();
  expect(screen.getByText('shop')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Connected in 12 ms.');
});

it('says why a test failed', async () => {
  serve({ configured: true, connector: 'mysql', label: 'MySQL', fields: { host: 'db.example.com' } }, { ok: false, error: { code: 'auth_failed', message: 'the database refused the sign-in' } });
  render(() => <DefaultConnectionPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('auth_failed: the database refused the sign-in');
});

it('says when the install has none, with no button', async () => {
  serve({ configured: false }, null);
  render(() => <DefaultConnectionPanel />);
  expect(await screen.findByText(/no default connection/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
});
