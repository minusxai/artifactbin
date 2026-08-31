/**
 * The WRITES row in the sharing dialog — where an owner turns a dataset from
 * read-only into read & write. It sits under the visibility row because it is
 * the same question ("who can do what with this"), it renders for datasets
 * ONLY, and it names the documents that would stop working before it closes.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShareLink from '@/components/ShareLink';

const state = {
  visibility: 'unlisted' as string,
  shares: [] as string[],
  access: 'read' as string,
  canPrivate: true,
  writtenBy: [] as Array<{ id: string; title: string | null; mutations: string[] }>,
};
let lastPut: Record<string, unknown> | null = null;

beforeEach(() => {
  Object.assign(state, { visibility: 'unlisted', shares: [], access: 'read', canPrivate: true, writtenBy: [] });
  lastPut = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/sharing')) {
      if (init?.method === 'PUT') {
        lastPut = JSON.parse(String(init.body));
        Object.assign(state, lastPut);
      }
      return new Response(JSON.stringify(state), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = () => fireEvent.click(screen.getByLabelText('Share'));

describe('ShareLink — writes', () => {
  it('offers the row for a DATASET only, and flips it with one PATCH-shaped PUT', async () => {
    render(<ShareLink className="x" artifactId="k3Pq9z" owner format="dataset" preview />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make read & write')).toBeTruthy());
    expect(screen.getByLabelText('Make read-only').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByLabelText('Make read & write'));
    await waitFor(() => expect(lastPut).toEqual({ access: 'readwrite' }));
    await waitFor(() => expect(screen.getByLabelText('Make read & write').getAttribute('aria-pressed')).toBe('true'));
    // The verdict travels to the button itself, beside the visibility one.
    expect(screen.getByLabelText('Share').textContent).toContain('writable');
  });

  it('is absent for a document, and for a dataset outside the preview', async () => {
    const { unmount } = render(<ShareLink className="x" artifactId="Ab3xK9" owner format="markup" preview />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make public')).toBeTruthy());
    expect(screen.queryByLabelText('Make read & write')).toBeNull();
    unmount();

    render(<ShareLink className="x" artifactId="k3Pq9z" owner format="dataset" />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make public')).toBeTruthy());
    expect(screen.queryByLabelText('Make read & write')).toBeNull();
  });

  it('names the documents that write here, and confirms before closing writes', async () => {
    state.access = 'readwrite';
    state.writtenBy = [{ id: 'Doc111', title: 'Lunch poll', mutations: ['vote'] }];
    render(<ShareLink className="x" artifactId="k3Pq9z" owner format="dataset" preview />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make read-only')).toBeTruthy());
    expect(screen.getByText(/Lunch poll/)).toBeTruthy();

    // Closing writes asks first — the rows stay, but those buttons stop working.
    fireEvent.click(screen.getByLabelText('Make read-only'));
    expect(lastPut).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/1 document/);
    fireEvent.click(screen.getByLabelText('Confirm read-only'));
    await waitFor(() => expect(lastPut).toEqual({ access: 'read' }));
  });

  it('skips the confirm when nothing writes here', async () => {
    state.access = 'readwrite';
    render(<ShareLink className="x" artifactId="k3Pq9z" owner format="dataset" preview />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make read-only')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Make read-only'));
    await waitFor(() => expect(lastPut).toEqual({ access: 'read' }));
  });

  it('hides `private` for an anonymous owner, who can still manage writes', async () => {
    state.canPrivate = false;
    state.visibility = 'public';
    render(<ShareLink className="x" artifactId="k3Pq9z" owner format="dataset" preview />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make read & write')).toBeTruthy());
    expect(screen.queryByLabelText('Make private')).toBeNull();
    expect(screen.getByLabelText('Make public')).toBeTruthy();
  });
});
