import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';
import { isSolidPage, solidDocumentReader } from '@/lib/solid-routes';
import { useAppHarness } from './harness';

useAppHarness();
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('serves the Solid entry for ported routes, while React owns other URLs', async () => {
  for (const route of ['/', '/assets', '/datasets/new', '/files/new']) expect(isSolidPage(route)).toBe(true);
  expect(isSolidPage('/a/fold01', 200, 'folder')).toBe(true);
  expect(isSolidPage('/a/doc01', 200, 'markup')).toBe(false);
  expect(isSolidPage('/a/data01', 200, 'dataset')).toBe(false);
  expect(isSolidPage('/@cee/data01', 200, 'dataset')).toBe(false);
  expect(isSolidPage('/@cee/fold01', 200, 'folder')).toBe(false);
  expect(isSolidPage('/a/data01/edit', 200, 'dataset')).toBe(true);
  expect(isSolidPage('/a/doc01/edit', 200, 'markup')).toBe(false);
  expect(isSolidPage('/@cee')).toBe(true);
  expect(isSolidPage('/@cee/doc-id')).toBe(true);
  expect(isSolidPage('/a/doc-id')).toBe(true);
  expect(isSolidPage('/a/doc-id/edit')).toBe(false);
  expect(solidDocumentReader('viewer', 'markup', false)).toBe(true);
  expect(solidDocumentReader('commenter', 'markup', false)).toBe(false);
  expect(solidDocumentReader('editor', 'markup', false)).toBe(false);
  expect(solidDocumentReader('owner', 'markup', false)).toBe(false);
  expect(solidDocumentReader('none', 'markup', false)).toBe(false);
  expect(solidDocumentReader('viewer', 'folder', false)).toBe(false);
  expect(solidDocumentReader('viewer', 'markup', true)).toBe(false);
  expect(isSolidPage('/missing', 404)).toBe(true);
  const dir = mkdtempSync(path.join(tmpdir(), 'afbin-shell-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body><script src="/main.tsx"></script></body></html>');
  writeFileSync(path.join(dir, 'solid-app.html'), '<html><head></head><body><script src="/solid-entry.tsx"></script></body></html>');
  const app = createAppServer({ webDir: dir });
  const accept = { Accept: 'text/html' };
  const trash = await app.request('http://localhost/trash', { headers: accept });
  expect(trash.status).toBe(200);
  expect(await trash.text()).toContain('/solid-entry.tsx');
  for (const route of ['/assets', '/datasets/new', '/files/new', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human']) {
    const response = await app.request(`http://localhost${route}`, { headers: accept });
    expect(await response.text()).toContain('/solid-entry.tsx');
  }
  const chat = await app.request('http://localhost/chat', { headers: accept });
  expect(await chat.text()).toContain('/solid-entry.tsx');
  const profile = await app.request('http://localhost/@cee', { headers: accept });
  expect(await profile.text()).toContain('/solid-entry.tsx');
  const missing = await app.request('http://localhost/definitely-missing', { headers: accept });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain('/solid-entry.tsx');
});
