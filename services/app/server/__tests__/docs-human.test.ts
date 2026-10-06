/**
 * The docs addresses. Browser visits to `/docs` redirect to `/docs-human`; machines and retired paths
 * underneath still get 404 with the CLI pointer (`/llms.txt`, `afbin help`). A guessed
 * API path answers that pointer as JSON rather than the SPA's HTML 404, which tells a fetch tool nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';

const SHELL = fs.readFileSync(path.resolve(__dirname, '../../web/solid-app.html'), 'utf8');
const app = createAppServer({ actorSecret: 'test-secret', indexHtml: async () => SHELL });
const BROWSER = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

describe('docs addresses', () => {
  useAppHarness();

  it('retired remote skill paths return 404 to machines and browsers', async () => {
    for(const path of ['/docs/artifactbin','/docs/artifactbin/SKILL.md','/docs/artifactbin/references/publishing.md']) {
      expect((await app.request(path)).status).toBe(404);
      expect((await app.request(path,{headers:BROWSER})).status).toBe(404);
    }
    // The remote MCP transport retired with them — moved here from the Hono route
    // smoke test, which keeps to the artifact routes it exists to prove.
    expect((await app.request('/mcp',{method:'POST'})).status).toBe(404);
  });

  it('redirects browser docs visits while retaining the agent help response', async () => {
    const browser = await app.request('/docs', { headers: BROWSER });
    expect(browser.status).toBe(302);
    expect(browser.headers.get('location')).toBe('/docs-human');
    expect(browser.headers.get('vary')).toContain('Accept');
    const target = await app.request(browser.headers.get('location')!, { headers: BROWSER });
    expect(target.status).toBe(200);
    expect(target.headers.get('content-type')).toContain('text/html');
    for (const accept of ['*/*', 'application/json']) {
      const agent = await app.request('/docs', { headers: { accept } });
      expect(agent.status).toBe(404);
      expect(await agent.json()).toEqual({ error: 'not_found', help: 'afbin help' });
    }
  });

  // The start-link brief, its claim door and the public anonymous mint are GONE, not merely unadvertised: the CLI's
  // device approval is the only door to a credential (moved here from the browser gate that started documents).
  it('the retired start-link and anonymous-mint doors are 404', async () => {
    // A REAL document, so the 404 is the door's absence and not a missing artifact's.
    const started = await app.request('/api/start', { method: 'POST' });
    expect(started.status).toBe(201);
    const { id } = await started.json() as { id: string };
    expect((await app.request(`/a/${id}`)).status, 'the document itself is served').toBe(200);
    expect((await app.request(`/a/${id}/start?k=anything`)).status, 'the start-link brief').toBe(404);
    expect((await app.request(`/a/${id}/start`, { method: 'POST' })).status, 'its claim door').toBe(404);
    expect((await app.request('/api/tokens/anonymous', { method: 'POST' })).status, 'the public anonymous mint').toBe(404);
  });

  it('/docs-human is the page for people, and /docs/human is retired with the rest of /docs', async () => {
    const human = await app.request('/docs-human', { headers: BROWSER });
    expect(human.status).toBe(200);
    expect(human.headers.get('content-type')).toContain('text/html');
    const old = await app.request('/docs/human', { headers: BROWSER });
    expect(old.status).toBe(404);
  });

  it('serves Getting started as a public page and a direct Markdown guide', async () => {
    const human = await app.request('/getting-started', { headers: BROWSER });
    expect(human.status).toBe(200);
    expect(human.headers.get('content-type')).toContain('text/html');
    const guide = await app.request('/getting-started.md');
    expect(guide.status).toBe(200);
    expect(guide.headers.get('content-type')).toContain('text/plain');
    const text = await guide.text();
    expect(text).toContain('# Getting started');
    expect(text).toContain('npx --yes @afbin/cli@latest setup');
    expect(text).toContain('npx.cmd --yes @afbin/cli@latest setup');
    expect(text).toContain('afbin help');
    expect(text).toContain('Claude Code, Codex, Pi, and OpenCode');
    expect(text).toContain('use the artifactbin skill');
    expect(text).toContain('afbin help to discover everything you can do');
    expect(text).toContain('Approve access in your browser');
    expect(text).toContain('--server');
    expect(text).toContain('afbin pull');
    expect(text).toContain('afbin push');
    const discovery = await (await app.request('/llms.txt')).text();
    expect(discovery).toContain('/getting-started.md');
    expect(discovery).not.toContain('Prepare Node:');
  });

  it('a guessed API path answers 404 JSON naming /docs, never the SPA', async () => {
    for (const p of ['/api', '/api/docs', '/openapi.json', '/.well-known/ai-plugin.json']) {
      const res = await app.request(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('content-type'), p).toContain('application/json');
      expect((await res.json()).help, p).toContain('afbin help');
    }
  });

  /**
   * Every dead end names the way on, not only the ones under `/api/`:
   * `/.well-known/deepseek` and `/help` must not hand a caller that never asked
   * for HTML the SPA shell. The split is what the caller ASKED FOR: no
   * `text/html` in Accept ⇒ the JSON refusal; a browser keeps its own 404 page.
   */
  it('answers a guessed path in the caller\'s own language', async () => {
    for (const p of ['/.well-known/deepseek', '/help']) {
      const machine = await app.request(p, { headers: { accept: '*/*' } });
      expect(machine.status, p).toBe(404);
      expect(machine.headers.get('content-type'), p).toContain('application/json');
      expect((await machine.json()).help, p).toContain('afbin help');
      const browser = await app.request(p, { headers: BROWSER });
      expect(browser.status, p).toBe(404);
      expect(browser.headers.get('content-type'), p).toContain('text/html');
      expect(await browser.text(), p).toContain('rel="help"');
    }
  });

  /**
   * The JSON 404 is mounted after the real routes and by EXACT path under
   * `/.well-known/`: a real endpoint must still answer itself, and
   * `/.well-known/oauth-protected-resource` belongs to the proxy.
   */
  it('shadows only the misses — a real endpoint and the proxy\'s well-known are untouched', async () => {
    const real = await app.request('/api/artifacts');
    expect(real.status).not.toBe(404);
    // `/.well-known/ai-plugin.json` answers JSON even to a browser; the
    // proxy's neighbour under the same prefix is untouched and still falls
    // through to the ordinary SPA miss.
    const plugin = await app.request('/.well-known/ai-plugin.json', { headers: BROWSER });
    expect(plugin.headers.get('content-type')).toContain('application/json');
    const wellKnown = await app.request('/.well-known/oauth-protected-resource', { headers: BROWSER });
    expect(wellKnown.headers.get('content-type')).toContain('text/html');
  });

  it('the shell carries the help link with a title and the agent meta', async () => {
    const html = await (await app.request('/login')).text();
    expect(html).toMatch(/<link rel="help" href="[^"]+\/llms.txt" title="[^"]+"/);
    expect(html).toMatch(/<meta name="afbin" content="[^"]*afbin[^"]*"/);
    expect(html).toContain('Windows: npx.cmd');
    expect(html).toContain('HTTP: email auth');
  });
});
