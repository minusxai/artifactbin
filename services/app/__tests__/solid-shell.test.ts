import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { START_PLACEHOLDER_MARKUP } from '@/lib/serving';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { request, useAppHarness } from './harness';

useAppHarness();
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('serves the one Solid entry for every address the app answers, whatever the format', async () => {
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
  // A served address of every non-compiled kind the Solid SPA used to answer: the data tiers and the
  // starter placeholder's read view. Each is the Solid entry now.
  const { token } = await mintToken('shell');
  const publish = async (body: Record<string, unknown>) => {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
    expect(made.status).toBe(201);
    return ((await made.json()) as { id: string }).id;
  };
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>').toString('base64');
  const served = {
    image: await publish({ title: 'Picture', image: svg }),
    dataset: await publish({ title: 'Rows', dataset: 'a,b\n1,2' }),
    viz: await publish({ title: 'Recipe', viz: { description: 'd', engine: 'vega-lite', bindings: [{ name: 'x', label: 'X', accepts: ['nominal'] }], template: { mark: 'bar', encoding: { x: { field: '{{x}}', type: 'nominal' } } } } }),
    file: await publish({ title: 'Notes', file: { filename: 'notes.txt', contentType: 'text/plain', base64: Buffer.from('hi').toString('base64') } }),
    starter: await publish({ title: null, markup: START_PLACEHOLDER_MARKUP }),
  };
  await drainPreparedPageWarmups();
  for (const [format, id] of Object.entries(served)) {
    const response = await app.request(`http://localhost/a/${id}`, { headers: accept });
    expect(response.status, format).toBe(200);
    const html = await response.text();
    expect(html, format).toContain('/solid-entry.tsx');
    expect(html, format).not.toContain('/main.tsx');
  }
});
