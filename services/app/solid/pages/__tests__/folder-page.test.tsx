/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route } from '@solidjs/router';
import { FolderPage } from '@/solid/pages/Folder';
import type { FolderPage as FolderData } from '@/lib/workspace/folders';
import type { AccountWorkspace } from '@/lib/workspace/dashboard';

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

it('mounts the owner listing and workspace rail without recursive updates', () => {
  const data = folder();
  const workspace = { artifacts: data.rows, shared: [], stats: { artifacts: 2, assets: 0, views: 0 }, views: {}, viewsOverTime: [], likes: 0, likesOverTime: [], followers: 0, forks: 0 } as unknown as AccountWorkspace;
  render(() => <MemoryRouter><Route path="*" component={() => <FolderPage folder={data} role="owner" workspace={workspace} />} /></MemoryRouter>);
  expect(screen.getByLabelText('Folder workspace')).toBeInTheDocument();
  expect(screen.getByLabelText('Open Doc aaa111')).toBeInTheDocument();
  expect(screen.getByLabelText('Dashboard metrics')).toBeInTheDocument();
});

it('keeps one live stream when a folder refresh updates its data but not its id', async () => {
  let changed: (() => void) | undefined;
  let connections = 0;
  vi.stubGlobal('EventSource', class { constructor() { connections++; } addEventListener(_name: string, callback: () => void) { changed = callback; } removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ folder: folder({ title: 'Updated' }) })));
  open('owner');
  expect(connections).toBe(1);
  changed?.();
  await screen.findByRole('heading', { name: 'Updated' });
  expect(connections).toBe(1);
});
