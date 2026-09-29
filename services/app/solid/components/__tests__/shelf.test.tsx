/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Shelf from '@/solid/components/Shelf';
import type { ShelfRow } from '@/lib/shelf';

const doc = (id: string, extra: Partial<ShelfRow> = {}): ShelfRow => ({ id, url: `/a/${id}`, title: `Doc ${id}`, format: 'markup', version: 1, updated_at: '2026-09-01T00:00:00.000Z', ...extra });
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
});

it('opens an artifact from its grid thumbnail while keeping secondary actions separate', () => {
  render(() => <Shelf rows={[doc('one')]} actions="full" />);
  const image = document.querySelector('[aria-label="Artifact grid"] img')!;
  const card = image.closest('li')!;
  expect(card.querySelector('a[aria-label="Open Doc one"]')).toHaveClass('after:inset-0');
  expect(screen.getByLabelText('Edit Doc one')).toHaveAttribute('href', '/a/one#edit');
});

it('opens a folder action menu without recursive updates', () => {
  render(() => <Shelf rows={[folder]} scopeParentId={null} actions="full" />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Reports' }));
  expect(screen.getByRole('button', { name: 'Delete Reports' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Reports' }));
  expect(screen.getByRole('dialog', { name: 'Delete Reports?' })).toBeInTheDocument();
});
