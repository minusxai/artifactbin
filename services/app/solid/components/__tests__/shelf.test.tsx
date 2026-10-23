/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Shelf, { RowActions } from '@/solid/components/Shelf';
import type { ShelfRow } from '@/lib/workspace/shelf';

const doc = (id: string, extra: Partial<ShelfRow> = {}): ShelfRow => ({ id, url: `/a/${id}`, title: `Doc ${id}`, format: 'html', version: 1, updated_at: '2026-09-01T00:00:00.000Z', ...extra });
const folder = doc('fold01', { title: 'Reports', format: 'folder' });
const posts: unknown[] = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return Response.json({ id: 'new01', title: 'New folder', format: 'folder' }, { status: 201 }); }
    return Response.json({ state: 'a'.repeat(64), version: 1 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows only immediate children and keeps the root shelf separate', () => {
  render(() => <Shelf rows={[folder, doc('child', { parent_id: 'fold01' }), doc('root')]} scopeParentId={null} actions="full" />);
  expect(screen.getByLabelText('Open folder Reports')).toBeInTheDocument();
  expect(screen.getByLabelText('Preview of folder Reports')).toHaveTextContent('1 artifact');
  expect(screen.getByLabelText('Open Doc root')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open Doc child')).toBeNull();
  expect(screen.getByLabelText('Open Doc root')).toHaveAttribute('rel', 'external');
});

it('lets the server draw a document link and keeps a folder link in the app, telling the address what it is', () => {
  render(() => <Shelf rows={[folder, doc('root')]} scopeParentId={null} actions="full" />);
  const folderLink = screen.getByLabelText('Open folder Reports');
  expect(folderLink).not.toHaveAttribute('rel');
  expect(folderLink).toHaveAttribute('state', JSON.stringify({ format: 'folder' }));
  expect(screen.getByLabelText('Open Doc root')).not.toHaveAttribute('state');
  expect(screen.queryByLabelText('Edit Doc root')).toBeNull();
});

it.each(['Grid', 'List'] as const)('opens native pages without an editor entry in the group %s shelf and keeps management actions', (view) => {
  const { container } = render(() => <Shelf rows={[doc('page', { title: 'Group page' })]} groupId="group01" actions="full" />);
  fireEvent.click(screen.getByRole('button', { name: `${view} view` }));
  expect(screen.getByRole('link', { name: 'Open Group page' })).toHaveAttribute('href', '/a/page');
  expect(screen.queryByRole('link', { name: 'Edit Group page' })).toBeNull();
  expect(container.querySelector('a[href*="#edit"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Group page' }));
  for (const name of ['Manage sharing for Group page', 'Move Group page', 'Transfer ownership of Group page', 'Delete Group page']) {
    expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  }
});

it('keeps the supported dataset editor as a separate route', () => {
  render(() => <RowActions row={doc('data', { format: 'dataset' })} level="full" folders={[]} childCount={0} onRemoved={() => {}} onChanged={() => {}} />);
  expect(screen.getByRole('link', { name: 'Edit Doc data' })).toHaveAttribute('href', '/a/data/edit');
});

it.each(['public', 'unlisted', 'private'] as const)('shows %s as an accessible icon and keeps artifact actions separate from navigation', async (visibility) => {
  render(() => <Shelf rows={[doc('one', { visibility })]} actions="full" />);
  const badge = screen.getByLabelText(`Doc one is ${visibility}`);
  expect(badge.querySelector('svg')).not.toBeNull();
  expect(badge.textContent).toBe('');
  fireEvent.focus(badge);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(visibility);
  await waitFor(() => expect(screen.getByRole('tooltip').querySelector('span')?.style.bottom).toBe('0px'));
  fireEvent.blur(badge);
  expect(screen.getByRole('link', { name: 'Open Doc one' })).toHaveAttribute('href', '/a/one');
  const menu = screen.getByRole('button', { name: 'More actions for Doc one' });
  expect(menu.closest('a')).toBeNull();
  fireEvent.click(menu);
  expect(screen.getByRole('menuitem', { name: 'Delete Doc one' })).toBeInTheDocument();
});

it('creates a child folder at the selected location', async () => {
  render(() => <Shelf rows={[]} scopeParentId="fold01" parentId="fold01" actions="full" canCreateFolders />);
  fireEvent.click(screen.getByLabelText('New folder'));
  fireEvent.input(screen.getByLabelText('Folder name'), { target: { value: 'New folder' } });
  fireEvent.keyDown(screen.getByLabelText('Folder name'), { key: 'Enter' });
  await waitFor(() => expect(posts).toEqual([{ format: 'folder', title: 'New folder', parent_id: 'fold01' }]));
  expect(await screen.findByLabelText('Open folder New folder')).toBeInTheDocument();
});

it('switches list and grid and keeps search accessible', () => {
  render(() => <Shelf rows={[doc('one'), doc('two')]} actions="full" />);
  expect(screen.getByLabelText('Search artifacts')).toBeInTheDocument();
  expect(screen.getByLabelText('Shelf view')).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Search artifacts'), { target: { value: 'one' } });
  expect(screen.getByLabelText('Open Doc one')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open Doc two')).toBeNull();
  fireEvent.click(screen.getByLabelText('List view'));
  expect(screen.getByLabelText('Open Doc one').querySelector('img')).toHaveAttribute('src', expect.stringContaining('/a/one/export?'));
});

it('hands every keystroke in its search box to onQuery, for a caller filtering something else by it (Home\'s "Shared with you")', () => {
  const heard: string[] = [];
  render(() => <Shelf rows={[doc('one'), doc('two')]} actions="full" onQuery={query => heard.push(query)} />);
  fireEvent.input(screen.getByLabelText('Search artifacts'), { target: { value: 'on' } });
  fireEvent.input(screen.getByLabelText('Search artifacts'), { target: { value: 'one' } });
  expect(heard).toEqual(['on', 'one']);
});

it('opens a folder action menu without recursive updates', () => {
  render(() => <Shelf rows={[folder]} scopeParentId={null} actions="full" />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Reports' }));
  expect(screen.getByRole('menuitem', { name: 'Delete Reports' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Reports' }));
  expect(screen.getByRole('dialog', { name: 'Delete Reports?' })).toBeInTheDocument();
});

it('filters the move picker to the account’s folders by name', () => {
  const decks = doc('fold02', { title: 'Decks', format: 'folder' });
  const row = doc('live01', { title: 'Live Note' });
  render(() => <Shelf rows={[folder, decks, row]} scopeParentId={null} actions="full" />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Live Note' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move Live Note' }));
  expect(screen.getByRole('dialog', { name: 'Move Live Note' })).toBeInTheDocument();
  expect(screen.getByLabelText('Move to root')).toBeInTheDocument();
  expect(screen.getByLabelText('Move to Reports')).toBeInTheDocument();
  expect(screen.getByLabelText('Move to Decks')).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Filter folders'), { target: { value: 'dec' } });
  expect(screen.queryByLabelText('Move to Reports')).toBeNull();
  expect(screen.getByLabelText('Move to Decks')).toBeInTheDocument();
  expect(screen.getByLabelText('Move to root')).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Filter folders'), { target: { value: '' } });
  expect(screen.getByLabelText('Move to Reports')).toBeInTheDocument();
});

it('keeps the view toggles and visibility filters pressed state accurate', () => {
  render(() => <Shelf rows={[doc('one', { visibility: 'public' }), doc('two', { visibility: 'private' })]} actions="none" />);
  const grid = screen.getByRole('button', { name: 'Grid view' }), list = screen.getByRole('button', { name: 'List view' });
  expect(grid).toHaveAttribute('aria-pressed', 'true');
  expect(list).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(list);
  expect(list).toHaveAttribute('aria-pressed', 'true');
  expect(grid).toHaveAttribute('aria-pressed', 'false');
  const pub = screen.getByRole('button', { name: 'Filter public' });
  fireEvent.click(pub);
  expect(pub).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Open Doc one')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open Doc two')).toBeNull();
  fireEvent.click(pub);
  expect(screen.getByLabelText('Open Doc two')).toBeInTheDocument();
});

it('pages a long list view with Previous and Next and says where it is', () => {
  const rows = Array.from({ length: 12 }, (_, index) => doc(`d${String(index).padStart(2, '0')}`));
  render(() => <Shelf rows={rows} actions="none" />);
  fireEvent.click(screen.getByRole('button', { name: 'List view' }));
  expect(screen.getByLabelText('Page range')).toHaveTextContent('1-10 of 12');
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByLabelText('Page range')).toHaveTextContent('11-12 of 12');
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(screen.getByLabelText('Page range')).toHaveTextContent('1-10 of 12');
});

it('renames a folder from its menu through a named text box and saves on Enter', async () => {
  render(() => <Shelf rows={[folder]} scopeParentId={null} actions="full" />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Reports' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Reports' }));
  const input = screen.getByRole('textbox', { name: 'Folder name' });
  expect(input).toHaveValue('Reports');
  fireEvent.input(input, { target: { value: 'Quarterly' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => String(init?.body ?? '').includes('"title":"Quarterly"'))).toBe(true));
});
