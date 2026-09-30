import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';
import { useAppHarness } from './harness';

useAppHarness();
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('serves the one Solid entry for every address the app answers', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'afbin-shell-'));
  dirs.push(dir);
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
