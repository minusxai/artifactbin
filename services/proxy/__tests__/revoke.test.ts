/** A revoke in the app reaches the proxy's reader at once in the full image: the composition root hands the app `reader.invalidate`. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemble, createTokenReader, inProcess } from '@artifactbin/utils';
import { getDb, resetDb } from '@/lib/db';
import { createAppServer } from '@/server/app';
import { proxyParts } from '../src/parts';
import { testProxyOptions } from './helpers';

const ADMIN = 'admin-secret-for-tests';
process.env.ADMIN__SECRET = ADMIN;

describe('revocation through the composed proxy', () => {
  let proxy: ReturnType<typeof assemble<any>>;
  beforeAll(async () => {
    const db = { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => (await getDb()).query<T>(sql, params as never) };
    const reader = createTokenReader({ db, ttlMs: 60_000 });
    const app = createAppServer({ indexHtml: async () => '<div id="root">SPA</div>', onTokenRevoked: (id?: string) => reader.invalidate(id) } as never);
    const base = await testProxyOptions();
    proxy = assemble(proxyParts({ ...base, tokens: reader, upstream: inProcess(app) }));
  });
  afterAll(() => resetDb());
  it('mint through the app, resolve through the proxy, revoke through the app: the very next request is nobody', async () => {
    const minted = await (await proxy.request('/api/tokens/anonymous', { method: 'POST' })).json() as { id: string; token: string };
    expect(minted.token).toMatch(/^mx_/);
    expect((await proxy.request('/api/artifacts', { headers: { authorization: `Bearer ${minted.token}` } })).status).toBe(200);
    expect((await proxy.request(`/api/tokens/${minted.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(204);
    expect((await proxy.request('/api/artifacts', { headers: { authorization: `Bearer ${minted.token}` } })).status).toBe(401);
  });
});
