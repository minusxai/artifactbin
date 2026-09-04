/** P2 (seeded RED) — the dashboard's folders strip and the inline create. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Shelf from '@/components/Shelf';

afterEach(cleanup);
const doc = { id: 'doc001', url: '/a/doc001', title: 'Board update', format: 'markup', version: 1, parent_id: null, ancestor_ids: [], visibility: 'private' as const, updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
const folder = { ...doc, id: 'rep001', url: '/a/rep001', title: 'Reports', format: 'folder' };
const posts: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); posts.push({ url, body }); return new Response(JSON.stringify({ id: 'new001', format: 'folder', title: body.title, parent_id: body.parent_id ?? null, ancestor_ids: [] }), { status: 201 }); }
    return new Response('{}', { status: 404 });
  }));
});

describe('a folder tile carries the folder\u2019s own actions', () => {
  const child = { ...doc, id: 'chd001', url: '/a/chd001', title: 'Inside', parent_id: 'rep001', ancestor_ids: ['rep001'] };
  const empty = { ...folder, id: 'emp001', url: '/a/emp001', title: 'Empty' };

  it('refuses to delete a folder with anything in it, and says how much', () => {
    render(<Shelf actions="full" rows={[folder, empty, child] as never} />);
    fireEvent.click(screen.getByLabelText('More actions for Reports'));
    const del = screen.getByLabelText('Delete Reports') as HTMLButtonElement;
    // Deleting a folder is deleting everything in it, so it has to be
    // something someone chose rather than discovered (P3 makes it a trash).
    expect(del.disabled).toBe(true);
    expect(del.textContent).toContain('1 inside');
  });

  it('an empty folder deletes like anything else', () => {
    render(<Shelf actions="full" rows={[folder, empty, child] as never} />);
    fireEvent.click(screen.getByLabelText('More actions for Empty'));
    expect((screen.getByLabelText('Delete Empty') as HTMLButtonElement).disabled).toBe(false);
  });

  it('moves a folder through the same picker every row uses', () => {
    render(<Shelf actions="full" rows={[folder, empty, child] as never} />);
    fireEvent.click(screen.getByLabelText('More actions for Reports'));
    fireEvent.click(screen.getByLabelText('Move Reports'));
    // Its own subtree is greyed — the cycle rule, drawn.
    expect((screen.getByLabelText('Move to Reports') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move to Empty') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the folders strip', () => {
  it('is absent without folders and lists them as tiles linking to /a/<id> when present', () => {
    const { unmount } = render(<Shelf actions="full" rows={[doc] as never} />);
    expect(screen.queryByLabelText('Folders')).toBeNull();
    unmount();
    render(<Shelf actions="full" rows={[doc, folder] as never} />);
    expect(screen.getByLabelText('Folders')).toBeTruthy();
    expect(screen.getByLabelText('Open folder Reports').getAttribute('href')).toBe('/a/rep001');
  });

  it('New folder is an inline name field: Enter creates a folder artifact at the current location, Escape discards', async () => {
    render(<Shelf actions="full" rows={[doc] as never} />);
    fireEvent.click(screen.getByLabelText('New folder'));
    const input = screen.getByLabelText('Folder name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Decks' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].body).toMatchObject({ format: 'folder', title: 'Decks', parent_id: null });
    await waitFor(() => expect(screen.getByLabelText('Open folder Decks')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('New folder'));
    fireEvent.keyDown(screen.getByLabelText('Folder name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Folder name')).toBeNull();
    expect(posts.length).toBe(1);
  });
});
