/** P2 (seeded RED) — the dashboard's folders strip and the inline create. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Shelf from '@/components/Shelf';

afterEach(cleanup);
const doc = { id: 'doc001', url: '/a/doc001', title: 'Board update', format: 'markup', version: 1, parent_id: null, ancestor_ids: [], visibility: 'private' as const, updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
const folder = { ...doc, id: 'rep001', url: '/a/rep001', title: 'Reports', format: 'folder' };
const posts: Array<{ url: string; body: any }> = [];
const deletes: string[] = [];
const asked: string[] = [];
const patches: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  posts.length = 0;
  deletes.length = 0;
  asked.length = 0;
  patches.length = 0;
  vi.stubGlobal('confirm', vi.fn((message: string) => { asked.push(message); return true; }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); posts.push({ url, body }); return new Response(JSON.stringify({ id: 'new001', format: 'folder', title: body.title, parent_id: body.parent_id ?? null, ancestor_ids: [] }), { status: 201 }); }
    if (init?.method === 'DELETE') { deletes.push(String(url)); return new Response('{}', { status: 200 }); }
    if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); patches.push({ url, body }); return new Response(JSON.stringify({ id: 'rep001', ...body }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('a folder tile carries the folder\u2019s own actions', () => {
  const child = { ...doc, id: 'chd001', url: '/a/chd001', title: 'Inside', parent_id: 'rep001', ancestor_ids: ['rep001'] };
  const empty = { ...folder, id: 'emp001', url: '/a/emp001', title: 'Empty' };

  it('deletes a folder WITH its contents, naming what goes, and drops the tile', async () => {
    /*
     * P3 made delete a TRASH, so the refusal this row used to draw is gone:
     * a folder and everything under it go in one statement, recoverable for 30
     * days. What survives is that deleting a folder is deleting everything in
     * it, so the count is still said — now in the confirm, where it is a fact
     * about what is ABOUT to happen rather than a reason it cannot.
     */
    render(<Shelf actions="full" rows={[folder, empty, child] as never} />);
    fireEvent.click(screen.getByLabelText('More actions for Reports'));
    const del = screen.getByLabelText('Delete Reports') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    expect(del.textContent).toContain('1 inside');
    fireEvent.click(del);
    await waitFor(() => expect(deletes).toEqual(['/api/my/artifacts/rep001']));
    expect(asked[0]).toBe('Delete Reports and the 1 item inside it? They go to the trash, and you can restore them any time.');
    // The tile leaves the strip, and so does what was under it — no reload.
    await waitFor(() => expect(screen.queryByLabelText('Open folder Reports')).toBeNull());
    expect(screen.getByLabelText('Open folder Empty')).toBeTruthy();
  });

  it('reads placement from the TRAIL too — which is all the dashboard sends', () => {
    /*
     * `/api/page/home` sends `ancestor_ids` and no `parent_id`: the trail is
     * the stored truth and the id is derived from it (its last element). A
     * shelf that read only the derived field counted every folder as empty and
     * offered a delete the door would refuse — which is what the browser gate
     * caught, with every fixture here passing because they all sent both.
     */
    const trailed = { ...child, parent_id: undefined, ancestor_ids: ['rep001'] };
    render(<Shelf actions="full" rows={[folder, empty, trailed] as never} />);
    fireEvent.click(screen.getByLabelText('More actions for Reports'));
    expect(screen.getByLabelText('Delete Reports').textContent).toContain('1 inside');
    // The folder nothing points at says nothing — the count is read, not assumed.
    fireEvent.click(screen.getByLabelText('More actions for Empty'));
    expect(screen.getByLabelText('Delete Empty').textContent).not.toContain('inside');
  });

  it('an empty folder is deleted with the plain warning — there is nothing inside to name', async () => {
    render(<Shelf actions="full" rows={[folder, empty, child] as never} />);
    fireEvent.click(screen.getByLabelText('More actions for Empty'));
    const del = screen.getByLabelText('Delete Empty') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(deletes).toEqual(['/api/my/artifacts/emp001']));
    expect(asked[0]).not.toContain('inside it');
    /*
     * P4: the wording a person answers has to be TRUE. It said "the link dies
     * and history is erased", which was the whole story when a delete was one
     * hard DELETE and is now half of it: the link does die, and everything
     * else is restorable. Pinned here because this is the only branch that
     * renders it — the folder branch above says its own sentence.
     */
    expect(asked[0]).toBe('Delete "Empty"? The link stops working. It goes to the trash, where you can restore it any time.');
  });

  /**
   * RENAMING IS THE ONE THING A FOLDER HAS. It has no content, so the editor
   * the pencil used to open would open on nothing — the verb it replaces, in
   * the place the other folder verbs already live, writing through the same
   * metadata door the folder page's own name uses (PATCH {title}: no version,
   * no archived copy for a string).
   */
  it('renames a folder in place from its menu, and offers no editor to open', async () => {
    render(<Shelf actions="full" rows={[folder] as never} />);
    expect(screen.queryByLabelText('Edit Reports'), 'a folder has no document to edit').toBeNull();
    fireEvent.click(screen.getByLabelText('More actions for Reports'));
    fireEvent.click(screen.getByLabelText('Rename Reports'));
    const field = screen.getByLabelText('Folder name') as HTMLInputElement;
    expect(field.value).toBe('Reports');
    fireEvent.change(field, { target: { value: 'Quarterly' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(patches).toEqual([{ url: '/api/my/artifacts/rep001', body: { title: 'Quarterly' } }]));
    expect(screen.getByLabelText('Open folder Quarterly')).toBeTruthy();
  });

  it('leaves a DOCUMENT its editor — only a folder loses the pencil', () => {
    render(<Shelf actions="full" rows={[doc] as never} />);
    expect(screen.getByLabelText('Edit Board update')).toBeTruthy();
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
