import { expect, it, vi } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import * as css from '@/lib/data/story/story-css.server';
import * as assets from '@/lib/story/assets/web-assets';
import * as artifacts from '@/lib/artifacts';
import * as relations from '@/lib/accounts/relations';
import * as tokens from '@/lib/accounts/tokens';
import * as profiles from '@/lib/accounts/profiles';
import { createAppServer } from '@/server/app';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { getDb } from '@/lib/platform';

useAppHarness();
// One row fetch and one access check per view (docs/phase2-architecture.md §2.2): the page's admission
// (server/app documentPreparation) hands its row to the bootstrap answer instead of the answer deciding again.
it('shares the server canonical/status row read AND its admission with the bootstrap answer', async () => {
  const token = await mintToken('server-preparation');
  const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'public', markup: '<p>Server preparation</p>' } }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const read = vi.spyOn(artifacts, 'getArtifactById');
  const admitted = vi.spyOn(artifacts, 'canReadArtifact');
  try {
    const app = createAppServer({ indexHtml: async () => '<head></head><body><div id="root"></div></body>' });
    const response = await app.request(`/a/${id}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Server preparation');
    expect(read.mock.calls.filter(([value]) => value === id)).toHaveLength(1);
    expect(admitted.mock.calls.filter(([row]) => row.id === id)).toHaveLength(1);
  } finally { read.mockRestore(); admitted.mockRestore(); }
});
it('reuses its admitted email session for display without synchronizing its profile again', async () => {
  const token = await mintToken('identity-preparation');
  const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'public', markup: '<p>Identity</p>' } }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const touch = vi.spyOn(tokens, 'touchToken');
  const sync = vi.spyOn(profiles, 'syncProfile');
  try {
    const response = await artifactPage(request(`/api/page/artifact/${id}`, { actor: { credential: 'session', userId: token.userId!, email: token.email!, emailVerified: true } }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).kind).toBe('account');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(touch).not.toHaveBeenCalled();
  } finally { touch.mockRestore(); sync.mockRestore(); }
});
it('serves a prepared version without compiling its CSS, and on a miss starts asset and social reads while CSS is pending', async () => {
  const token = await mintToken('preparation');
  const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'public', markup: '<p>Parallel preparation</p>' } }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  await drainPreparedPageWarmups();
  const compiled = vi.spyOn(css, 'currentStoryCss');
  try {
    expect((await artifactPage(request(`/api/page/artifact/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(compiled).not.toHaveBeenCalled();
  } finally { compiled.mockRestore(); }
  // A miss (the prepared page is gone) compiles, and the reads that need no CSS do not wait for it.
  await (await getDb()).query('DELETE FROM prepared_pages');
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const original = css.currentStoryCss;
  const cssSpy = vi.spyOn(css, 'currentStoryCss').mockImplementation(async (...args) => { entered(); await held; return original(...args); });
  const urls = vi.spyOn(assets, 'lookupWebAssets');
  const social = vi.spyOn(relations, 'count');
  const pending = artifactPage(request(`/api/page/artifact/${id}`), { params: Promise.resolve({ id }) });
  await started;
  await new Promise(resolve => setTimeout(resolve, 0));
  const calls = [urls.mock.calls.length, social.mock.calls.length];
  release();
  try {
    expect((await pending).status).toBe(200);
    expect(calls[0]).toBe(1); expect(calls[1]).toBeGreaterThan(0);
  } finally { cssSpy.mockRestore(); urls.mockRestore(); social.mockRestore(); }
});
