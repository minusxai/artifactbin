/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderPage } from '@/solid/pages/Folder';
import type { FolderPage as FolderData } from '@/lib/folders';

const row = (id: string, format = 'markup', title = `Doc ${id}`) => ({ id, url: `/a/${id}`, title, format, version: 1, visibility: 'public' as const, parent_id: 'fold01', ancestor_ids: ['fold01'], updated_at: '2026-09-01T00:00:00.000Z' });
const folder = (over: Record<string, unknown> = {}) => ({ id: 'fold01', title: 'Reports', trail: [], count: { documents: 2, folders: 1 }, rows: [row('aaa111'), row('bbb222'), row('ccc333', 'folder', 'Q3')], ...over }) as FolderData;
const open = (role: 'owner' | 'editor' | 'commenter' | 'viewer', data = folder(), ownerUsername?: string) => render(() => <FolderPage folder={data} role={role} ownerUsername={ownerUsername} />);
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'fold01', title: 'Quarterly', state: 'a'.repeat(64), version: 1 })));
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('names the folder, count and readable trail', () => {
  open('viewer', folder({ trail: [{ id: 'r1', title: 'Work', url: '/a/r1' }] }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports');
  expect(screen.getByText('2 documents and 1 folder')).toBeInTheDocument();
  const trail = within(screen.getByLabelText('Folder trail'));
  expect(trail.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  expect(trail.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '/a/r1');
});

it('offers rename only to writers and saves by conditional metadata PATCH', async () => {
  open('owner');
  fireEvent.click(screen.getByLabelText('Rename folder'));
  fireEvent.input(screen.getByLabelText('Folder name'), { target: { value: 'Quarterly' } });
  fireEvent.keyDown(screen.getByLabelText('Folder name'), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Quarterly'));
  await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url, init]) => url === '/api/my/artifacts/fold01' && init?.method === 'PATCH')).toBe(true));
  cleanup();
  open('viewer');
  expect(screen.queryByLabelText('Rename folder')).toBeNull();
  expect(screen.getByLabelText('Open folder Q3')).toBeInTheDocument();
});

it('keeps an empty folder actionable for writers and quiet for viewers', () => {
  open('owner', folder({ rows: [], count: { documents: 0, folders: 0 } }));
  expect(screen.getByLabelText('Empty folder')).toHaveTextContent('parent_id');
  expect(screen.getByLabelText('New folder')).toBeInTheDocument();
  cleanup();
  open('viewer', folder({ rows: [], count: { documents: 0, folders: 0 } }));
  expect(screen.getByLabelText('Empty folder')).not.toHaveTextContent('parent_id');
  expect(screen.queryByLabelText('New folder')).toBeNull();
});
