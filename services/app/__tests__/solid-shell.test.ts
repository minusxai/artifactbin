import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';
import { useAppHarness } from './harness';

useAppHarness();
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('serves the Solid entry only for Trash, while React owns the other URLs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'afbin-shell-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body><script src="/main.tsx"></script></body></html>');
  writeFileSync(path.join(dir, 'trash.html'), '<html><head></head><body><script src="/solid-entry.tsx"></script></body></html>');
  const app = createAppServer({ webDir: dir });
  const accept = { Accept: 'text/html' };
  const trash = await app.request('http://localhost/trash', { headers: accept });
  expect(trash.status).toBe(200);
  expect(await trash.text()).toContain('/solid-entry.tsx');
  const login = await app.request('http://localhost/login', { headers: accept });
  expect(await login.text()).toContain('/main.tsx');
});
