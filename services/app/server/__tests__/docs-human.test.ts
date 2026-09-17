/**
 * `/docs` and `/docs/*` belong to agents; people get `/docs-human`. Decision 2026-09-03 after production eval run
 * 33702277600, where a fetch tool asking for HTML was bounced from `/docs` to the human tour mid-discovery, and
 * where guessed API paths answered the SPA's HTML 404 with no pointer home. Seeded RED by the orchestrator.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';

const SHELL = fs.readFileSync(path.resolve(__dirname, '../../web/index.html'), 'utf8');
const app = createAppServer({ actorSecret: 'test-secret', indexHtml: async () => SHELL });
const BROWSER = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

describe('docs addresses', () => {
  useAppHarness();

  it('retired remote skill paths return 404 to machines and browsers', async () => {
    for(const path of ['/docs','/docs/artifactbin','/docs/artifactbin/SKILL.md','/docs/artifactbin/references/publishing.md']) {
      expect((await app.request(path)).status).toBe(404);
      expect((await app.request(path,{headers:BROWSER})).status).toBe(404);
    }
    // The remote MCP transport retired with them — moved here from the Hono route
    // smoke test, which keeps to the artifact routes it exists to prove.
    expect((await app.request('/mcp',{method:'POST'})).status).toBe(404);
  });

  it('/docs-human is the page for people, and /docs/human sends them there', async () => {
    const human = await app.request('/docs-human', { headers: BROWSER });
    expect(human.status).toBe(200);
    expect(human.headers.get('content-type')).toContain('text/html');
    const old = await app.request('/docs/human', { headers: BROWSER });
    expect(old.status).toBe(404);
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
   * Every dead end names `/docs`, not only the ones under `/api/`. Measured on
   * production 2026-09-03: `/.well-known/deepseek` and `/help` both answered
   * the 891-byte SPA shell — HTML, with no pointer — to a caller that never
   * asked for HTML. The split is what the caller ASKED FOR: no `text/html` in
   * Accept ⇒ the JSON refusal; a browser keeps its own 404 page.
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
    const html = await (await app.request('/')).text();
    expect(html).toMatch(/<link rel="help" href="[^"]+\/llms.txt" title="[^"]+"/);
    expect(html).toMatch(/<meta name="afbin" content="[^"]*afbin[^"]*"/);
  });
});
