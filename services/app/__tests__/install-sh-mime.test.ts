// /install.sh is a shell script and must be served as one (S5). Seeded RED by the orchestrator.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';

const app = () => createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>', publicDir: path.resolve(__dirname, '..', 'public') });

describe('GET /install.sh', () => {
  it('serves the installer as text/x-shellscript', async () => {
    const res = await app().request('/install.sh');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^text\/x-shellscript/);
    expect((await res.text()).startsWith('#!')).toBe(true);
  });
});

describe('GET /chat/*.sh', () => {
  it.each(['/chat/install.sh', '/chat/uninstall.sh'])('serves %s as a briefly cached shell script for `curl … | sh`', async (route) => {
    const res = await app().request(route);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^text\/x-shellscript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await res.text()).startsWith('#!/bin/sh')).toBe(true);
  });
});
