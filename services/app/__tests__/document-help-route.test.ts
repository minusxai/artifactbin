/**
 * DISCOVER: the REAL reader route serves the help pointer — as an HTTP `Link: <…/llms.txt>; rel="help"` header (for
 * agents that read headers or strip HTML) and in <head> — built on the request's own base URL.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { createArtifact } from '@/lib/artifacts';
import { agentBlurb } from '@/lib/serving';

import { mintToken } from '@/lib/accounts';
import { createUser, ensureUsername } from '@/lib/accounts';
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
    const row = await createArtifact(t.id, null, { format: 'markup', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const res = await rawRoute(new Request(`${BASE}/a/${row.id}`), params(row.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${BASE}/llms.txt>; rel="help"`);
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API">`);
    expect(html).toContain(`<meta name="afbin" content="afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.">`);
  });
  it('the plain app shell carries the same head pointer, and /llms.txt is the one-pager on the request base', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const shell = await app.request(`${BASE}/login`, { headers: { accept: 'text/html' } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API">`);
    expect(html.match(/name="afbin"/g)).toHaveLength(1);
    // FIRST in the head: a fetch that keeps only the first few kilobytes must still see the pointer
    // (it sat after every preload link, one line past where OpenCode's fetch cut).
    expect(html.indexOf('<link rel="help"')).toBeLessThan(html.indexOf('<title>SPA</title>'));
    expect(html.indexOf('<link rel="help"')).toBe(html.indexOf('<head>') + '<head>'.length);
    const attributed = createAppServer({ indexHtml: async () => '<!doctype html><html><head lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/x.css"></head><body></body></html>' });
    const shell2 = await (await attributed.request(`${BASE}/login`, { headers: { accept: 'text/html' } })).text();
    expect(shell2.indexOf('<link rel="help"')).toBe(shell2.indexOf('<head lang="en">') + '<head lang="en">'.length);
    expect(shell2.indexOf('<link rel="help"')).toBeLessThan(shell2.indexOf('<link rel="stylesheet"'));
    const llms = await app.request(`${BASE}/llms.txt`);
    expect(llms.status).toBe(200);
    const text = await llms.text();
    expect(text.split('\n')[0]).toBe(agentBlurb());
    expect(agentBlurb()).toMatch(/^artifactbin: .*npm CLI or direct HTTP API\.$/);
    expect(text).toContain(`${BASE}/getting-started.md`);
    expect(text).not.toContain('@afbin/cli@latest setup');
    const gettingStarted = await app.request(`${BASE}/getting-started.md`);
    expect(gettingStarted.status).toBe(200);
    const setup = await gettingStarted.text();
    expect(setup).toContain('npx --yes @afbin/cli@latest setup');
    expect(setup).toContain(`${BASE}/chat/install.ps1`);
    expect(setup).toContain('npx.cmd --yes @afbin/cli@latest setup');
    expect(text).toContain('POST '+BASE+'/api/auth/email-otp/send-verification-otp');
    expect(text).toContain('POST '+BASE+'/api/auth/sign-in/email-otp');
    expect(text).toContain('POST '+BASE+'/api/authentication/token');
    expect(text).toContain('Authorization: Bearer <access_token>');
    expect(text).toContain('function buildPlainTextUpdate(snapshot, nodeId, before, after)');
    expect(text).toContain('patch.claims');
    expect(text).toContain('/api/artifacts/<id>/edits');
    expect(text).toContain('HTTP client does not need Node or the CLI');
    expect(text).toContain('guest browser approval is CLI-only');
    expect(text).toContain('Local and offline edits do not call these HTTP endpoints');
    expect(text).not.toContain('[[ base ]]');
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const refused = await app.request(`${BASE}/api/artifacts/${row.id}`);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: 'unauthorized', help: `Retry through afbin: afbin auth --server ${BASE}. If \`afbin\` is not installed, run \`npx --yes @afbin/cli@latest setup\` once (Windows PowerShell: \`npx.cmd --yes @afbin/cli@latest setup\`); it installs the \`afbin\` command and the agent skills.`, guide: `${BASE}/llms.txt` });
  });
  it('follows x-forwarded-proto/host like every other absolute URL the app emits', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, { format: 'markup', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
    const res = await rawRoute(new Request(`${BASE}/a/${row.id}`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'docs.example' } }), params(row.id));
    expect(res.headers.get('link')).toBe('<https://docs.example/llms.txt>; rel="help"');
  });
  it('a shared /a/<id> is served in place with the pointer in its header and head, and names its canonical address', async () => {
    const owner = await ensureUsername(await createUser({ email: 'redirect-help@example.com' }));
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, { format: 'markup', source: '<div>hop</div>', meta: {}, title: 'Hop', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const res = await app.request(`${BASE}/a/${row.id}`);
    // No hop: a fetch that does not follow redirects reads the document itself.
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const canonical = `/@${owner.username}/${row.id}-hop`;
    expect(res.headers.get('link')).toBe(`<${BASE}/llms.txt>; rel="help"`);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API">`);
    expect(html).toContain(`<meta name="afbin" content="afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.">`);
    expect(html).toContain('hop');
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${canonical}">`));
    expect(html).toContain(`"address":"${canonical}"`);
  });
  it('repeats the pointer as the LAST thing before </body>, where a tail-keeping reader still sees it', async () => {
    const owner = await ensureUsername(await createUser({ email: 'tail-help@example.com' }));
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, { format: 'markup', source: '<div>tail</div>', meta: {}, title: 'Tail', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const tail = `<!-- Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API: ${BASE}/llms.txt. afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API. --></body>`;
    for (const path of [`/@${owner.username}/${row.id}-tail`, '/login', `/a/${row.id}/raw`]) {
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
    const row = await createArtifact(t.id, owner.id, { format: 'markup', source: '<div>pretty</div>', meta: {}, title: 'Pretty help', description: null, visibility: 'public' });
    const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
    const res = await app.request(`${BASE}/@${owner.username}/${row.id}-pretty-help`);
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${BASE}/llms.txt>; rel="help"`);
    const html = await res.text();
    expect(html).toContain(`<link rel="help" href="${BASE}/llms.txt" title="Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API">`);
    expect(html).toContain(`<meta name="afbin" content="afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.">`);
  });
});
