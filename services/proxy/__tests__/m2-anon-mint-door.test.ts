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
import { isBrowserContext, proxyParts } from '../src/parts';
import { BROWSER_MINT_HEADERS, testProxyOptions } from './helpers';

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

  it('leaves every other route alone, mint-shaped or not', async () => {
    const proxy = await proxyFor();
    for (const path of ['/api/artifacts', '/api/tokens', '/api/tokens/claim', '/a/ab3cd9/start']) {
      const res = await proxy.fetch(new Request(`http://localhost${path}`, { method: 'POST' }));
      expect(res.status, path).not.toBe(403);
    }
  });

  it('refuses a GET-only pretender: the headers, not the method, are what is checked', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', {
      method: 'POST', headers: { origin: 'http://localhost' },
    }));
    expect(res.status).toBe(403);
  });

  it('refuses a cross-site browser fetch — sec-fetch-site tells us it is not our page', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', {
      method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' },
    }));
    expect(res.status).toBe(403);
  });

  /**
   * The production shape, and the one that would have silently blocked the real page: behind TLS
   * termination the browser says `origin: https://artifactbin.dev` while this hop received plain http.
   * The check compares HOSTS for exactly this reason.
   */
  it('lets the real page through behind a TLS-terminating hop', async () => {
    let reached = false;
    const proxy = assemble(await proxyParts(await testProxyOptions({
      env: { RATE_LIMITER__ANON_MINT_MAX: '1000', APP__PUBLIC_BASE_URL: 'https://artifactbin.dev' },
      upstream: async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); },
    })));
    const res = await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', {
      method: 'POST',
      headers: { origin: 'https://artifactbin.dev', 'sec-fetch-site': 'same-origin' },
    }));
    expect(reached).toBe(true);
    expect(res.status).toBe(201);
  });

  it('an agent that named no harness still gets an untagged door, never a broken URL', async () => {
    const proxy = await proxyFor();
    const body = await (await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', { method: 'POST' }))).json() as { tokens: string };
    expect(body.tokens).toBe('http://localhost/tokens/new');
  });

  it('ignores a harness it does not know, rather than reflecting it into a URL', async () => {
    const proxy = await proxyFor();
    const body = await (await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', {
      method: 'POST', headers: { 'artifactbin-agent': 'evil"><script>' },
    }))).json() as { tokens: string };
    expect(body.tokens).toBe('http://localhost/tokens/new');
  });
});

/**
 * TWO DECISIONS TAKEN HERE, both of which fail SILENTLY if they go the other way.
 */
describe('the door beside the limiter, and the hosts it calls its own', () => {
  it('does not spend the ANON_MINT budget its own advice sends the human back to use', async () => {
    // The refusal says "ask your human for a token at /tokens/new". If the refusals themselves counted,
    // an agent retrying a few times would 429 the human it just sent to that page — same IP, same NAT.
    const options = await testProxyOptions({ env: { RATE_LIMITER__ANON_MINT_MAX: '2', RATE_LIMITER__ANON_MINT_BURST: '2' } });
    const proxy = assemble(await proxyParts(options));
    for (let i = 0; i < 6; i += 1) {
      expect((await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', { method: 'POST' }))).status).toBe(403);
    }
    // The budget is untouched: the page still gets its two.
    const page = () => proxy.fetch(new Request('http://localhost/api/tokens/anonymous', { method: 'POST', headers: BROWSER }));
    expect((await page()).status).not.toBe(429);
    expect((await page()).status).not.toBe(429);
    expect((await page()).status).toBe(429);
  });

  it('lets the page through on a hostname that is not the configured one', async () => {
    // APP__PUBLIC_BASE_URL says localhost; a person opens 127.0.0.1. Refusing here is an outage whose only
    // symptom is "Could not generate a token", with nothing in the logs saying why.
    let reached = false;
    const proxy = assemble(await proxyParts(await testProxyOptions({
      env: { RATE_LIMITER__ANON_MINT_MAX: '1000', APP__PUBLIC_BASE_URL: 'http://localhost:5401' },
      upstream: async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); },
    })));
    const res = await proxy.fetch(new Request('http://127.0.0.1:5401/api/tokens/anonymous', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5401', 'sec-fetch-site': 'same-origin' },
    }));
    expect(reached).toBe(true);
    expect(res.status).toBe(201);
  });

  it('still refuses a stranger host that is neither', async () => {
    const proxy = assemble(await proxyParts(await testProxyOptions({
      env: { RATE_LIMITER__ANON_MINT_MAX: '1000', APP__PUBLIC_BASE_URL: 'http://localhost:5401' },
    })));
    const res = await proxy.fetch(new Request('http://127.0.0.1:5401/api/tokens/anonymous', {
      method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' },
    }));
    expect(res.status).toBe(403);
  });

  it('tags a harness the app would tag, however it was spelled', async () => {
    const proxy = await proxyFor();
    const body = await (await proxy.fetch(new Request('http://localhost/api/tokens/anonymous', {
      method: 'POST', headers: { 'artifactbin-agent': 'Claude Code' },
    }))).json() as { tokens: string };
    expect(body.tokens).toBe('http://localhost/tokens/new?source=claude-code');
  });
});

describe('isBrowserContext', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it('needs BOTH signals: fetch metadata and a matching origin', () => {
    expect(isBrowserContext(h({}), 'http://localhost')).toBe(false);
    expect(isBrowserContext(h({ origin: 'http://localhost' }), 'http://localhost')).toBe(false);
    expect(isBrowserContext(h({ 'sec-fetch-site': 'same-origin' }), 'http://localhost')).toBe(false);
    expect(isBrowserContext(h({ origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }), 'http://localhost')).toBe(true);
  });
  it('matches on host, so a terminated scheme or a garbage origin does not decide it', () => {
    expect(isBrowserContext(h({ origin: 'https://a.test', 'sec-fetch-site': 'same-origin' }), 'http://a.test')).toBe(true);
    expect(isBrowserContext(h({ origin: 'https://a.test:8443', 'sec-fetch-site': 'same-origin' }), 'http://a.test')).toBe(false);
    expect(isBrowserContext(h({ origin: 'null', 'sec-fetch-site': 'same-origin' }), 'http://a.test')).toBe(false);
  });
});
