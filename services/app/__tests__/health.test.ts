/**
 * GET /health — is this process able to serve?
 *
 * Found on production the day #157 deployed: the container was reported
 * UNHEALTHY, failing streak 7, while serving every page correctly. Its probe
 * fetched `/docs/llm`, an address the docs tree had retired — so a content
 * change turned the deployment red, and a permanently-red check is one nobody
 * reads on the day it finally means something.
 *
 * The lesson is not "point the probe somewhere else". A liveness probe must
 * not ask whether a particular DOCUMENT exists; it asks whether the process is
 * up. That is a different question and it deserves its own address, which is
 * allowed to be boring and is never allowed to move.
 *
 * SHALLOW ON PURPOSE. It does not touch the database or the object store: a
 * probe that fails when Postgres blips restarts a server that would have
 * recovered on its own, and whether the store is reachable belongs to whoever
 * set the configuration, not to every process that starts.
 */
import { describe, expect, it } from 'vitest';
import { GET as health } from '@/app/health/route';
import { request } from '@/__tests__/harness';

describe('GET /health', () => {
  it('answers 200 with a tiny, stable body', async () => {
    const res = await health(request('/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('is never cached — a probe reading a cached answer proves nothing', async () => {
    expect((await health(request('/health'))).headers.get('Cache-Control')).toBe('no-store');
  });

  /*
   * No auth, no session, no invite. A probe runs inside the container with no
   * credentials at all, and a health endpoint that can 401 is a health
   * endpoint that reports unhealthy for the wrong reason.
   */
  it('needs no credential of any kind', async () => {
    const bare = new Request('http://localhost:3000/health');
    expect((await health(bare)).status).toBe(200);
  });

  it('says nothing about the deployment', async () => {
    const text = JSON.stringify(await (await health(request('/health'))).json());
    for (const leak of ['version', 'commit', 'env', 'host', 'database']) {
      expect(text.toLowerCase()).not.toContain(leak);
    }
  });
});
