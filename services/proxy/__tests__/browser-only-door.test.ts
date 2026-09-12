/**
 * THE CREATE BUTTON IS A BROWSER DOOR.
 *
 * A real page sends `origin: <the deployment's own origin>` and `sec-fetch-site: same-origin` on its
 * fetch, and both survive this proxy to the upstream untouched; a bare HTTP client sends neither.
 * `POST /api/start` is the web page's own button — an agent that posts it instead of running afbin
 * is mid-mistake, and the refusal is where we hand it the CLI.
 * The GET shape of the same path is NOT gated: only the create is.
 */
import { describe, it, expect } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { isBrowserContext, proxyParts } from '../src/parts';
import { policyFile, RELAXED_POLICY_FILE, testProxyOptions } from './helpers';

const BROWSER = { 'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

const proxyFor = async (upstream?: (req: Request) => Promise<Response>) =>
  assemble(await proxyParts(await testProxyOptions({
    env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE },
    ...(upstream ? { upstream } : {}),
  })));

describe('the create-button door', () => {
  it('refuses a bare client — no origin, no sec-fetch-site, no browser', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/start', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('teaches the CLI in the refusal instead of just saying no', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/start', {
      method: 'POST', headers: { 'artifactbin-agent': 'claude-code' },
    }));
    const body = await res.json() as Record<string, unknown>;
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/mcp|plugin/i);
    expect(text).toContain('afbin');
    expect(text).toContain('authenticates itself');
    expect(text).toContain('afbin help');
    // The refusal points at the CLI and at how to get it — never at a page to visit.
    expect(text).toContain('/chat/install.sh');
    for (const banned of ['token', 'paste', 'claim', 'mint', 'MCP', '/raw', '/docs/']) {
      expect(text.toLowerCase(), `the refusal must not say "${banned}"`).not.toContain(banned.toLowerCase());
    }
  });

  it('lets the product\'s own page through', async () => {
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); });
    const res = await proxy.fetch(new Request('http://localhost/api/start', { method: 'POST', headers: BROWSER }));
    expect(reached).toBe(true);
    expect(res.status).toBe(201);
  });

  it('never touches a GET of the same path — only the create is a button', async () => {
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{"ok":true}'); });
    const res = await proxy.fetch(new Request('http://localhost/api/start'));
    expect(reached).toBe(true);
    expect(res.status).toBe(200);
  });

  it('leaves every other route alone, mint-shaped or not', async () => {
    const proxy = await proxyFor();
    for (const path of ['/api/artifacts', '/api/tokens', '/api/tokens/claim', '/api/my/artifacts']) {
      const res = await proxy.fetch(new Request(`http://localhost${path}`, { method: 'POST' }));
      expect(res.status, path).not.toBe(403);
    }
  });

  it('refuses a GET-only pretender: the headers, not the method, are what is checked', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/start', {
      method: 'POST', headers: { origin: 'http://localhost' },
    }));
    expect(res.status).toBe(403);
  });

  it('refuses a cross-site browser fetch — sec-fetch-site tells us it is not our page', async () => {
    const proxy = await proxyFor();
    const res = await proxy.fetch(new Request('http://localhost/api/start', {
      method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' },
    }));
    expect(res.status).toBe(403);
  });

  /**
   * The deployed shape, and the one that would silently block the real page: behind TLS
   * termination the browser says `origin: https://<host>` while this hop received plain http.
   * The check compares HOSTS for exactly this reason.
   */
  it('lets the real page through behind a TLS-terminating hop', async () => {
    let reached = false;
    const proxy = assemble(await proxyParts(await testProxyOptions({
      env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE, APP__PUBLIC_BASE_URL: 'https://docs.example' },
      upstream: async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); },
    })));
    const res = await proxy.fetch(new Request('http://localhost/api/start', {
      method: 'POST',
      headers: { origin: 'https://docs.example', 'sec-fetch-site': 'same-origin' },
    }));
    expect(reached).toBe(true);
    expect(res.status).toBe(201);
  });

});

/**
 * TWO DECISIONS TAKEN HERE, both of which fail SILENTLY if they go the other way.
 */
describe('the door beside the limiter, and the hosts it calls its own', () => {
  it('does not spend the start budget its own advice sends the human back to use', async () => {
    // The refusal tells the agent to just run afbin (which authenticates itself). If the refusals
    // themselves counted, an agent retrying a few times would 429 the human on the same IP and NAT.
    const options = await testProxyOptions({ env: { PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_2_burst_2.yml') } });
    const proxy = assemble(await proxyParts(options));
    for (let i = 0; i < 6; i += 1) {
      expect((await proxy.fetch(new Request('http://localhost/api/start', { method: 'POST' }))).status).toBe(403);
    }
    // The budget is untouched: the page still gets its two.
    const page = () => proxy.fetch(new Request('http://localhost/api/start', { method: 'POST', headers: BROWSER }));
    expect((await page()).status).not.toBe(429);
    expect((await page()).status).not.toBe(429);
    expect((await page()).status).toBe(429);
  });

  it('lets the page through on a hostname that is not the configured one', async () => {
    // APP__PUBLIC_BASE_URL says localhost; a person opens 127.0.0.1. Refusing here is an outage whose only
    // symptom is "Could not generate a token", with nothing in the logs saying why.
    let reached = false;
    const proxy = assemble(await proxyParts(await testProxyOptions({
      env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE, APP__PUBLIC_BASE_URL: 'http://localhost:5401' },
      upstream: async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); },
    })));
    const res = await proxy.fetch(new Request('http://127.0.0.1:5401/api/start', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5401', 'sec-fetch-site': 'same-origin' },
    }));
    expect(reached).toBe(true);
    expect(res.status).toBe(201);
  });

  it('still refuses a stranger host that is neither', async () => {
    const proxy = assemble(await proxyParts(await testProxyOptions({
      env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE, APP__PUBLIC_BASE_URL: 'http://localhost:5401' },
    })));
    const res = await proxy.fetch(new Request('http://127.0.0.1:5401/api/start', {
      method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' },
    }));
    expect(res.status).toBe(403);
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
