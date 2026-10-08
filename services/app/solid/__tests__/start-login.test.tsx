/* @jsxImportSource solid-js */
import { render, screen, cleanup, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { StartPage } from '../pages/Start';
import { replaceDocument } from '../lib/document-navigation';
vi.mock('../lib/document-navigation', () => ({ replaceDocument: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });
it('returns a signed-out creator to this exact start entry after email login', async () => {
  window.history.replaceState(null, '', '/start?agent=1');
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  render(() => <StartPage />);
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/login?callbackUrl=%2Fstart%3Fagent%3D1'));
  expect(fetch).toHaveBeenCalledOnce();
});
it('does not repeat a creation or redirect to login after an uncertain server failure', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetch);
  render(() => <StartPage />);
  await screen.findByRole('alert');
  expect(replaceDocument).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});
