import { expect, it, vi } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { mintToken } from '@/lib/tokens';
import * as css from '@/lib/data/story/story-css.server';
import * as assets from '@/lib/web-assets';
import * as artifacts from '@/lib/artifacts';
import * as relations from '@/lib/relations';
import * as tokens from '@/lib/tokens';
import { createAppServer } from '@/server/app';

useAppHarness();
it('shares the server canonical/status row read while keeping bootstrap admission independent', async () => {
  const token = await mintToken('server-preparation');
  const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { markup: '<p>Server preparation</p>' } }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const read = vi.spyOn(artifacts, 'getArtifactById');
  try {
    const app = createAppServer({ indexHtml: async () => '<head></head><body><div id="root"></div></body>' });
    const response = await app.request(`/a/${id}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Server preparation');
    expect(read.mock.calls.filter(([value]) => value === id)).toHaveLength(2);
  } finally { read.mockRestore(); }
});
it('reuses its admitted browser identity for session display instead of touching the token again', async () => {
  const token = await mintToken('identity-preparation');
  const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { markup: '<p>Identity</p>' } }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const touch = vi.spyOn(tokens, 'touchToken');
  try {
    const response = await artifactPage(request(`/api/page/artifact/${id}`, { actor: { credential: 'agent-cookie', tokenId: token.id } }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).kind).toBe('anon');
    expect(touch).toHaveBeenCalledTimes(1);
  } finally { touch.mockRestore(); }
});
it('starts independent reference, asset and social reads while CSS is pending, after admission', async () => {
  const token = await mintToken('preparation');
  const created = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { markup: '<p>Parallel preparation</p>' } }));
  expect(created.status).toBe(201);
  const { id } = await created.json();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const original = css.currentStoryCss;
  const cssSpy = vi.spyOn(css, 'currentStoryCss').mockImplementation(async (...args) => { entered(); await held; return original(...args); });
  const refs = vi.spyOn(artifacts, 'refDataForRow');
  const urls = vi.spyOn(assets, 'webAssetsForSource');
  const social = vi.spyOn(relations, 'count');
  const pending = artifactPage(request(`/api/page/artifact/${id}`), { params: Promise.resolve({ id }) });
  await started;
  await new Promise(resolve => setTimeout(resolve, 0));
  const calls = [refs.mock.calls.length, urls.mock.calls.length, social.mock.calls.length];
  release();
  try {
    expect((await pending).status).toBe(200);
    expect(calls[0]).toBe(1); expect(calls[1]).toBe(1); expect(calls[2]).toBeGreaterThan(0);
  } finally { cssSpy.mockRestore(); refs.mockRestore(); urls.mockRestore(); social.mockRestore(); }
});
