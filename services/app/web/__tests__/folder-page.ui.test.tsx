/**
 * THE FOLDER PAGE — identity above, contents below, and nothing else.
 *
 * A folder page is not read, it is scanned and left. So the NAME is the one
 * thing given weight, the trail above it is an address in the face addresses
 * are set in, the count is a sentence a person would say ("3 documents and 1
 * folder", not "3 · 1"), and a single hairline separates who this is from what
 * is in it. That hairline is the only rule on the page and it is structural.
 *
 * What is pinned here is the part a person can lose: which verbs each role is
 * offered, that renaming happens on the name itself rather than behind a
 * dialog, that an empty folder says what to do instead of nothing, and that the
 * page always draws a `<main>` — the export camera names that element, and a
 * folder with no children still has a card to take.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { FolderPage } from '@/web/pages/Folder';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_o', email: 'o@x.io' } } }) }));

const child = (id: string, format = 'markup', title = `Doc ${id}`) => ({
  id, url: `/a/${id}`, title, description: null, format, version: 1,
  visibility: 'public' as const, parent_id: 'fold01', ancestor_ids: ['fold01'],
  updated_at: '2026-08-20T00:00:00.000Z',
});

const folder = (over: Record<string, unknown> = {}) => ({
  id: 'fold01', title: 'Reports', trail: [], count: { documents: 2, folders: 1 },
  rows: [child('aaa111'), child('bbb222'), child('ccc333', 'folder', 'Q3')],
  ...over,
});

const draw = (props: { folder: ReturnType<typeof folder>; role: 'owner' | 'editor' | 'commenter' | 'viewer' }) =>
  render(<MemoryRouter><FolderPage {...props} /></MemoryRouter>);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'fold01', title: 'Quarterly' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  // jsdom ships no EventSource. The live path has its own coverage in the
  // browser gate, where a real agent write has to reach a real open page.
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the head', () => {
  it('gives the NAME the only weight on the page, and the count as a sentence', () => {
    draw({ folder: folder(), role: 'owner' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports');
    expect(screen.getByText('2 documents and 1 folder')).toBeInTheDocument();
  });

  it('says one document without a plural, and nothing at all when the folder is empty', () => {
    const { unmount } = draw({ folder: folder({ rows: [child('aaa111')], count: { documents: 1, folders: 0 } }), role: 'owner' });
    expect(screen.getByText('1 document')).toBeInTheDocument();
    unmount();
    draw({ folder: folder({ rows: [], count: { documents: 0, folders: 0 } }), role: 'owner' });
    // No count sentence at all — "0 documents" is a worse answer than the
    // empty state, which says the same thing and then says what to do.
    expect(screen.queryByText(/^\d+ (document|folder)/)).not.toBeInTheDocument();
  });

  it('draws the trail as plain links, root to parent, and none at the root', () => {
    const { unmount } = draw({ folder: folder(), role: 'viewer' });
    expect(screen.queryByLabelText('Folder trail')).not.toBeInTheDocument();
    unmount();
    draw({
      folder: folder({ trail: [{ id: 'r1', title: 'Work', url: '/a/r1' }, { id: 'r2', title: '2026', url: '/a/r2' }] }),
      role: 'viewer',
    });
    const trail = screen.getByLabelText('Folder trail');
    const links = [...trail.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Work', '2026']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/a/r1', '/a/r2']);
  });

  it('always draws a <main> — the export camera names that element, empty folder or not', () => {
    const { container } = draw({ folder: folder({ rows: [], count: { documents: 0, folders: 0 } }), role: 'viewer' });
    expect(container.querySelector('main')).toBeTruthy();
  });
});

describe('renaming happens on the name', () => {
  it('is offered to an owner and an editor, and to nobody else', () => {
    for (const role of ['owner', 'editor'] as const) {
      const { unmount } = draw({ folder: folder(), role });
      expect(screen.getByLabelText('Rename folder'), role).toBeInTheDocument();
      unmount();
    }
    for (const role of ['commenter', 'viewer'] as const) {
      const { unmount } = draw({ folder: folder(), role });
      expect(screen.queryByLabelText('Rename folder'), role).not.toBeInTheDocument();
      unmount();
    }
  });

  it('saves on Enter through the metadata door, and shows the new name', async () => {
    draw({ folder: folder(), role: 'owner' });
    fireEvent.click(screen.getByLabelText('Rename folder'));
    const field = screen.getByLabelText('Folder name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Quarterly' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/my/artifacts/fold01');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Quarterly' });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Quarterly'));
  });

  it('cancels on Escape, keeping the old name and writing nothing', async () => {
    draw({ folder: folder(), role: 'owner' });
    fireEvent.click(screen.getByLabelText('Rename folder'));
    const field = screen.getByLabelText('Folder name');
    fireEvent.change(field, { target: { value: 'Nope' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the shelf below the hairline', () => {
  it('gives an owner the row verbs and a New folder that lands INSIDE this folder', () => {
    draw({ folder: folder(), role: 'owner' });
    expect(screen.getByLabelText('New folder')).toBeInTheDocument();
    expect(screen.getByLabelText('Open folder Q3')).toBeInTheDocument();
  });

  it('gives a stranger the documents and no verbs at all', () => {
    draw({ folder: folder(), role: 'viewer' });
    expect(screen.queryByLabelText('New folder')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rename folder')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open folder Q3')).toBeInTheDocument();
  });

  it('an empty folder invites the two things that actually put something in it', () => {
    draw({ folder: folder({ rows: [], count: { documents: 0, folders: 0 } }), role: 'owner' });
    const empty = screen.getByLabelText('Empty folder');
    expect(empty.textContent).toContain('parent_id');
    expect(empty.textContent).toContain('fold01');
  });
});
