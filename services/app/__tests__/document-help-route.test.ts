/**
 * DISCOVER: the REAL reader route serves the help pointer — as an HTTP `Link: <…/llms.txt>; rel="help"` header (for
 * agents that read headers or strip HTML) and in <head> — built on the request's own base URL. Seeded RED.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { createArtifact } from '@/lib/artifacts';
import { agentBlurb } from '@/lib/agent-discovery';

import { mintToken } from '@/lib/tokens';
import { createUser, ensureUsername } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /a/:id (the document itself)', () => {
  it('the native query door authenticates before revealing whether a document exists', async () => {
    const app = createAppServer();
    const anonymous = await app.request(`${BASE}/api/artifacts/zzzzzz/query`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    expect(anonymous.status).toBe(401);
    const token=await mintToken('mxmx_test_query_help');
    const missing=await app.request(`${BASE}/api/artifacts/zzzzzz/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token.token}`},body:'{}'});
    expect(missing.status).toBe(404);expect(await missing.json()).toMatchObject({error:'not_found'});
  });

  it('carries Link: <base>/llms.txt; rel="help" and the head pointer, on the request base', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const res = await rawRoute(new Request(`${BASE}/a/${row.id}`), params(row.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${BASE}/llms.txt>; rel="help"`);
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: read this to create, edit, or operate artifacts on the CLI using afbin">`);
    expect(html).toContain(`<meta name="afbin" content="afbin: a CLI to operate artifacts. Install: curl -fsSL ${BASE}/chat/install.sh | sh">`);
  });
  it('the plain app shell carries the same head pointer, and /llms.txt is the one-pager on the request base', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const shell = await app.request(`${BASE}/`, { headers: { accept: 'text/html' } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: read this to create, edit, or operate artifacts on the CLI using afbin">`);
    expect(html.match(/name="afbin"/g)).toHaveLength(1);
    // FIRST in the head: a fetch that keeps only the first few kilobytes must still see the pointer
    // (run 35133663437: it sat after every preload link, one line past where OpenCode's fetch cut).
    expect(html.indexOf('<link rel="help"')).toBeLessThan(html.indexOf('<title>SPA</title>'));
    expect(html.indexOf('<link rel="help"')).toBe(html.indexOf('<head>') + '<head>'.length);
    const attributed = createAppServer({ indexHtml: async () => '<!doctype html><html><head lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/x.css"></head><body></body></html>' });
    const shell2 = await (await attributed.request(`${BASE}/`, { headers: { accept: 'text/html' } })).text();
    expect(shell2.indexOf('<link rel="help"')).toBe(shell2.indexOf('<head lang="en">') + '<head lang="en">'.length);
    expect(shell2.indexOf('<link rel="help"')).toBeLessThan(shell2.indexOf('<link rel="stylesheet"'));
    const llms = await app.request(`${BASE}/llms.txt`);
    expect(llms.status).toBe(200);
    const text = await llms.text();
    expect(text.split('\n')[0]).toBe(agentBlurb());
    expect(agentBlurb()).toMatch(/^artifactbin: .*afbin CLI\.$/);
    expect(text).toContain(`curl -fsSL ${BASE}/chat/install.sh | sh`);
    expect(text).not.toContain('afbin setup');
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const refused = await app.request(`${BASE}/api/artifacts/${row.id}`);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: 'unauthorized', help: `Retry — afbin authenticates itself when it needs the server; there is nothing to set up. Install it if it is missing: curl -fsSL ${BASE}/chat/install.sh | sh`, guide: `${BASE}/llms.txt` });
  });
  it('follows x-forwarded-proto/host like every other absolute URL the app emits', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const res = await rawRoute(new Request(`${BASE}/a/${row.id}`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'docs.example' } }), params(row.id));
    expect(res.headers.get('link')).toBe('<https://docs.example/llms.txt>; rel="help"');
  });
  it('a healing 302 carries the pointer in its header and body, so an unfollowed redirect still names the way on', async () => {
    const owner = await ensureUsername(await createUser({ email: 'redirect-help@example.com' }));
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, { format: 'markup', content: '', source: '<div>hop</div>', meta: {}, title: 'Hop', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const res = await app.request(`${BASE}/a/${row.id}`);
    expect(res.status).toBe(302);
    const canonical = `/@${owner.username}/${row.id}-hop`;
    expect(res.headers.get('location')).toBe(canonical);
    expect(res.headers.get('link')).toBe(`<${BASE}/llms.txt>; rel="help"`);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: read this to create, edit, or operate artifacts on the CLI using afbin">`);
    expect(html).toContain(`<meta name="afbin" content="afbin: a CLI to operate artifacts. Install: curl -fsSL ${BASE}/chat/install.sh | sh">`);
    expect(html).toContain(`The document is at ${BASE}${canonical}`);
    expect(html).toContain(`<a href="${BASE}${canonical}">`);
  });
  it('repeats the pointer as the LAST thing before </body>, where a tail-keeping reader still sees it', async () => {
    const owner = await ensureUsername(await createUser({ email: 'tail-help@example.com' }));
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, { format: 'markup', content: '', source: '<div>tail</div>', meta: {}, title: 'Tail', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const tail = `<!-- Agents: read this to create, edit, or operate artifacts on the CLI using afbin: ${BASE}/llms.txt. afbin: a CLI to operate artifacts. Install: curl -fsSL ${BASE}/chat/install.sh | sh --></body>`;
    for (const path of [`/@${owner.username}/${row.id}-tail`, '/', `/a/${row.id}/raw`]) {
      const res = await app.request(`${BASE}${path}`, { headers: { accept: 'text/html' } });
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html.slice(html.lastIndexOf('<!--')), path).toMatch(new RegExp(`^${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</html>\\s*$`));
      expect(html.match(/name="afbin"/g), path).toHaveLength(1);
    }
  });
  it('carries the same header and head pointer at an owned artifact pretty URL', async () => {
    const owner = await ensureUsername(await createUser({ email: 'pretty-help@example.com' }));
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, { format: 'markup', content: '', source: '<div>pretty</div>', meta: {}, title: 'Pretty help', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const res = await app.request(`${BASE}/@${owner.username}/${row.id}-pretty-help`);
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${BASE}/llms.txt>; rel="help"`);
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: read this to create, edit, or operate artifacts on the CLI using afbin">`);
    expect(html).toContain(`<meta name="afbin" content="afbin: a CLI to operate artifacts. Install: curl -fsSL ${BASE}/chat/install.sh | sh">`);
  });
});
