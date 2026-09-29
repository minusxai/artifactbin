import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';
import { isSolidPage } from '@/lib/solid-routes';
import { useAppHarness } from './harness';

useAppHarness();
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('serves the Solid entry for ported routes, while React owns other URLs', async () => {
  for (const route of ['/', '/assets', '/datasets/new', '/files/new']) expect(isSolidPage(route)).toBe(true);
  expect(isSolidPage('/a/fold01', 200, 'folder')).toBe(true);
  expect(isSolidPage('/a/doc01', 200, 'markup')).toBe(false);
  expect(isSolidPage('/a/data01/edit', 200, 'dataset')).toBe(true);
  expect(isSolidPage('/a/doc01/edit', 200, 'markup')).toBe(false);
  expect(isSolidPage('/@cee')).toBe(true);
  expect(isSolidPage('/@cee/doc-id')).toBe(false);
  expect(isSolidPage('/missing', 404)).toBe(true);
  const dir = mkdtempSync(path.join(tmpdir(), 'afbin-shell-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body><script src="/main.tsx"></script></body></html>');
  writeFileSync(path.join(dir, 'trash.html'), '<html><head></head><body><script src="/solid-entry.tsx"></script></body></html>');
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
  expect(await chat.text()).toContain('/main.tsx');
  const missing = await app.request('http://localhost/definitely-missing', { headers: accept });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain('/solid-entry.tsx');
});
