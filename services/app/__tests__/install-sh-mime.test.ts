// /install.sh is a shell script and must be served as one (S5). Seeded RED by the orchestrator.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';

describe('GET /install.sh', () => {
  it('serves the installer as text/x-shellscript', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>', publicDir: path.resolve(__dirname, '..', 'public') });
    const res = await app.request('/install.sh');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^text\/x-shellscript/);
    expect((await res.text()).startsWith('#!')).toBe(true);
  });
});
