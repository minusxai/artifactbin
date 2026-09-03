/**
 * M2 — the anonymous mint is a BROWSER door.
 *
 * MEASURED on production before this was written: the real `/tokens/new` page sends
 * `origin: https://artifactbin.dev` + `sec-fetch-site: same-origin` on its mint fetch, both survive this
 * proxy to the upstream, and a bare curl with none of them gets a token anyway. That last part is what
 * closes here — for `/api/tokens/anonymous` ONLY. `/api/start` shares the ANON_MINT rate-limit door and
 * is posted by agents with no browser: gating it would kill the very flow we steer people toward.
 */
import { describe, it, expect } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { proxyParts } from '../src/parts';
import { testProxyOptions } from './helpers';

const BROWSER = { 'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

const proxyFor = async (upstream?: (req: Request) => Promise<Response>) =>
  assemble(await proxyParts(await testProxyOptions({
    env: { RATE_LIMITER__ANON_MINT_MAX: '1000' },
    ...(upstream ? { upstream } : {}),
  })));

describe('the anonymous mint door', () => {
  it('refuses a bare client — no origin, no sec-fetch-site, no browser', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('teaches the ladder in the refusal instead of just saying no', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', {
      method: 'POST', headers: { 'artifactbin-agent': 'claude-code' },
    }));
    const body = await res.json() as Record<string, unknown>;
    const text = JSON.stringify(body);
    expect(text).toMatch(/mcp|plugin/i);
    expect(text).toContain('/tokens/new');
    expect(text).toContain('source=claude-code');
  });

  it('lets the product\'s own page through', async () => {
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); });
    const res = await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', { method: 'POST', headers: BROWSER }));
    expect(reached).toBe(true);
    expect(res.status).toBe(201);
  });

  it('never touches /api/start — a start link is posted by an agent with no browser', async () => {
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{"ok":true}'); });
    const res = await proxy.fetch(new Request('http://localhost/api/start', { method: 'POST' }));
    expect(reached).toBe(true);
    expect(res.status).toBe(200);
  });
});
