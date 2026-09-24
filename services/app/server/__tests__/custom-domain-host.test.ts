/**
 * THE CUSTOM-HOST BOUNDARY, through the real app server.
 *
 * A request whose host is a VERIFIED custom domain gets the owner's home page,
 * their public documents as posts with no reader chrome, those documents'
 * read-side routes and the static runtime — and 404 for everything else, with
 * no Set-Cookie ever. Any other host behaves exactly as it did. The artifactbin
 * copy of a public document whose owner has a verified domain names the domain
 * as canonical; the certificate ask check answers from verified rows alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ target: 'domains.example.test' as string | null, session: '' }));
vi.mock('@/lib/config', async (original) => ({
  ...(await original<typeof import('@/lib/config')>()),
  get CUSTOM_DOMAINS_TARGET() { return settings.target; },
  get PUBLIC_BASE_URL() { return 'https://app.example.test'; },
}));
vi.mock('@/auth', () => ({ auth: async () => (settings.session ? { user: { id: settings.session } } : null) }));

import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { attachDomain, removeDomain, setDomainResolver, verifyDomain, type DomainResolver } from '@/lib/custom-domains';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, setUsername } from '@/lib/users';
import { createAppServer } from '../app';

useAppHarness();

const APP = 'https://app.example.test';
const HOST = 'https://blog.example.org';
const TARGET_IP = '203.0.113.10';
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const app = () => createAppServer({ indexHtml: async () => SHELL });

/** DNS that agrees with whatever hostname and token the test verifies. */
const agreeing = (hostname: string, token: string): DomainResolver => ({
  txt: async (name) => (name === `_artifactbin.${hostname}` ? [token] : []),
  addresses: async (name) => (name === hostname || name === 'domains.example.test' ? [TARGET_IP] : []),
  caa: async () => [],
});

async function owner(name: string) {
  const t = await mintToken(name);
  const u = await createUser({ email: `${name}@example.com` });
  await claimToken(u.id, t.token);
  await setUsername(u.id, name);
  return { token: t.token, userId: u.id };
}
async function create(token: string, body: Record<string, unknown>) {
  const res = await createRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
}
async function verified(userId: string, hostname = 'blog.example.org') {
  const attached = await attachDomain(userId, hostname);
  if ('error' in attached) throw new Error(attached.error);
  const done = await verifyDomain(userId, hostname, agreeing(hostname, attached.txtValue));
  if ('error' in done) throw new Error(done.error);
}

const LOCAL_DOC = `<Helmet>
<Value name="count" type="number" default={0} />
<Value name="drafts" type="table" value={[{id: 1}]} />
<Query name="current">{\`select id, count from drafts cross join _signals\`}</Query>
<Mutation name="inc">{\`update _signals set count=count+1\`}</Mutation>
</Helmet><h1>Counter post</h1><Button run="$inc">Increment</Button><DataTable data="$current" />`;
const pollDoc = (ds: string) => `<Helmet><Value name="choice" type="string" default="ramen" />`
  + `<Mutation name="vote" source="ref:${ds}">{\`insert into public.rows (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<h1>Poll post</h1><Button run="$vote">Vote</Button>';

async function world() {
  const vivek = await owner('vivek');
  const other = await owner('stranger');
  const post = await create(vivek.token, { markup: '<h1>Hello from my blog</h1><p>First words.</p>', title: 'Hello World', description: 'A first post', visibility: 'public' });
  const folder = await create(vivek.token, { format: 'folder', title: 'Notes', visibility: 'public' });
  const filed = await create(vivek.token, { markup: '<h1>Filed away</h1>', title: 'Filed post', visibility: 'public', parent_id: folder.id });
  const quiet = await create(vivek.token, { markup: '<h1>Quiet</h1>', title: 'Unlisted draft', visibility: 'unlisted' });
  const secret = await create(vivek.token, { markup: '<h1>Secret</h1>', title: 'Private plan', visibility: 'private' });
  const local = await create(vivek.token, { markup: LOCAL_DOC, title: 'Counter', visibility: 'public' });
  const ds = await create(vivek.token, { dataset: [{ choice: 'tacos' }], access: 'readwrite', visibility: 'public' });
  const poll = await create(vivek.token, { markup: pollDoc(ds.id), title: 'Poll', visibility: 'public' });
  const theirs = await create(other.token, { markup: '<h1>Not Vivek</h1>', title: 'Stranger post', visibility: 'public' });
  await verified(vivek.userId);
  return { vivek, other, post, folder, filed, quiet, secret, local, ds, poll, theirs };
}

const noCookie = (res: Response) => expect(res.headers.get('set-cookie')).toBeNull();

beforeEach(() => { settings.target = 'domains.example.test'; settings.session = ''; });
afterEach(() => { setDomainResolver(null); });

describe('the home page on a verified host', () => {
  it('lists only the owner\'s public documents, filed or not, server-rendered with links and the footer', async () => {
    const w = await world();
    const res = await app().request(`${HOST}/`, { headers: { accept: 'text/html', cookie: 'mx_session=anything' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    noCookie(res);
    const html = await res.text();
    expect(html).toContain(`href="/${w.post.id}-hello-world"`);
    expect(html).toContain('Hello World');
    expect(html).toContain('A first post');
    expect(html).toContain(`href="/${w.filed.id}-filed-post"`);
    for (const hidden of ['Unlisted draft', 'Private plan', 'Stranger post', 'Notes']) expect(html).not.toContain(hidden);
    expect(html).toContain('<link rel="canonical" href="https://blog.example.org/">');
    expect(html).toMatch(/Made with <a href="https:\/\/app\.example\.test\/@vivek"[^>]*>artifactbin<\/a>/);
    expect(html).toContain('<title>');
    // No app shell: no SPA root, no bootstrap.
    expect(html).not.toContain('id="root"');
    expect((await app().request(`${HOST}/`, { method: 'HEAD' })).status).toBe(200);
  });
});

describe('a post on a verified host', () => {
  it('serves the document with no reader chrome, the footer, a self-canonical and its unfurl tags', async () => {
    const w = await world();
    const res = await app().request(`${HOST}/${w.post.id}-hello-world`, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    noCookie(res);
    const html = await res.text();
    expect(html).toContain('Hello from my blog');
    // The document keeps its own layout styles; no reader-chrome ELEMENT is rendered.
    const markup = html.replace(/<style[\s\S]*?<\/style>/g, '');
    expect(markup).not.toMatch(/mx-reader-|data-mx-login|data-mx-reader/);
    expect(html).toContain('data-mx-domain-footer');
    expect(html).toContain(`<link rel="canonical" href="https://blog.example.org/${w.post.id}-hello-world">`);
    expect(html).toMatch(new RegExp(`Made with <a href="https://app\\.example\\.test/a/${w.post.id}"[^>]*>artifactbin</a>`));
    expect(html).toContain('<meta property="og:title" content="Hello World">');
    expect(html).toContain('<meta name="description" content="A first post">');
    // The card is photographed on the app, which is where /export is served.
    expect(html).toContain(`content="https://app.example.test/a/${w.post.id}/export?mode=card`);
    expect(html).not.toContain('rel="help"');
    // Its runtime calls go to THIS host, the only one its CSP admits.
    expect(res.headers.get('content-security-policy')).toContain(`connect-src ${HOST}/a/${w.post.id}/query`);
    expect(res.headers.get('link')).toBeNull();
  });

  it('accepts the bare id, and redirects a wrong slug to the canonical one on the same host, keeping the query', async () => {
    const w = await world();
    expect((await app().request(`${HOST}/${w.post.id}`)).status).toBe(200);
    const wrong = await app().request(`${HOST}/${w.post.id}-old-title?$pick=a`);
    expect(wrong.status).toBe(302);
    expect(wrong.headers.get('location')).toBe(`/${w.post.id}-hello-world?$pick=a`);
    noCookie(wrong);
  });

  it('ignores the capture, archive and editing switches: the post is always the plain reader copy', async () => {
    const w = await world();
    const res = await app().request(`${HOST}/${w.post.id}-hello-world?chrome=0&version=1&edit=1&comment=1&key=forged`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Made with');
    expect(html).not.toContain('read-only');
  });

  it('answers 404 — never a redirect — for another owner\'s, an unlisted or a private document, a folder and a stranger id', async () => {
    const w = await world();
    for (const id of [w.theirs.id, w.quiet.id, w.secret.id, w.folder.id, w.ds.id, 'zzzzzz']) {
      const res = await app().request(`${HOST}/${id}`, { headers: { accept: 'text/html' } });
      expect(res.status, id).toBe(404);
      noCookie(res);
    }
  });
});

describe('everything else on a verified host is 404', () => {
  it('refuses the app: login, api, profiles, app document addresses and the SPA', async () => {
    const w = await world();
    for (const path of ['/login', '/account', '/api/server', '/api/health', `/api/domains/allow?domain=blog.example.org`, '/api/my/domain',
      '/@vivek', `/@vivek/${w.post.id}-hello-world`, `/a/${w.post.id}`, `/a/${w.post.id}/raw`, `/a/${w.post.id}/export?mode=card`, '/llms.txt', '/chat/install.sh', '/og.png', '/nope/deeper']) {
      const res = await app().request(`${HOST}${path}`, { headers: { accept: 'text/html' } });
      expect(res.status, path).toBe(404);
      noCookie(res);
    }
    const posted = await app().request(`${HOST}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(posted.status).toBe(404);
  });

  it('serves a public post\'s read-side routes, and scopes them to the owner\'s public documents', async () => {
    const w = await world();
    const q = encodeURIComponent(JSON.stringify({ only: ['current'] }));
    const own = await app().request(`${HOST}/a/${w.local.id}/query?q=${q}`);
    expect(own.status, await own.clone().text()).toBe(200);
    noCookie(own);
    // The app's GET query door admits unlisted documents to anyone; this host does not.
    for (const id of [w.quiet.id, w.theirs.id, w.secret.id]) {
      expect((await app().request(`${HOST}/a/${id}/query?q=${q}`)).status, id).toBe(404);
      expect((await app().request(`${HOST}/a/${id}/resolve?ref=ref:${id}`)).status, id).toBe(404);
      expect((await app().request(`${HOST}/a/${id}/events/frame`)).status, id).toBe(404);
    }
    const frame = await app().request(`${HOST}/a/${w.post.id}/events/frame`);
    expect(frame.status).toBe(200);
    expect((await app().request(`${HOST}/story/author-frame?artifact=${w.post.id}`)).status).toBe(200);
  });

  it('admits a query POST only with the reader\'s local tables', async () => {
    const w = await world();
    const post = (body: unknown) => app().request(`${HOST}/a/${w.local.id}/query`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    const withLocal = await post({ only: ['current'], values: { count: 3 }, localTables: { drafts: [{ id: 7 }] } });
    expect(withLocal.status, await withLocal.clone().text()).toBe(200);
    expect(await withLocal.json()).toMatchObject({ tables: { current: { rows: [{ id: 7, count: 3 }] } } });
    expect((await post({ only: ['current'] })).status).toBe(404);
    expect((await post('not json')).status).toBe(404);
  });

  it('runs a local mutation, and refuses every dataset-writing one without touching the dataset', async () => {
    const w = await world();
    const mutate = (id: string, body: unknown) => app().request(`${HOST}/a/${id}/mutate`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    const local = await mutate(w.local.id, { mutation: 'inc', values: { count: 1 } });
    expect(local.status, await local.clone().text()).toBe(200);
    expect(await local.json()).toMatchObject({ ok: true, local: { target: '_signals' } });
    const before = (await getArtifactById(w.ds.id))!.version;
    const write = await mutate(w.poll.id, { mutation: 'vote', values: { choice: 'ramen' } });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: 'dataset_read_only' });
    expect((await getArtifactById(w.ds.id))!.version).toBe(before);
    expect((await mutate(w.theirs.id, { mutation: 'inc' })).status).toBe(404);
    const preflight = await app().request(`${HOST}/a/${w.local.id}/mutate`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
  });
});

describe('hosts that are not verified mappings behave as before', () => {
  it('serves the app on its own host, an unverified name and a pending one', async () => {
    const w = await world();
    const stranger = await owner('pendingowner');
    const pending = await attachDomain(stranger.userId, 'pending.example.org');
    expect('error' in pending).toBe(false);
    for (const origin of [APP, 'https://unknown.example.org', 'https://pending.example.org', 'http://localhost:3000']) {
      const login = await app().request(`${origin}/login`, { headers: { accept: 'text/html' } });
      expect(login.status, origin).toBe(200);
      expect(await login.text()).toContain('id="root"');
      expect((await app().request(`${origin}/a/${w.quiet.id}/raw`)).status, origin).toBe(200);
    }
  });
});

describe('the canonical link on the artifactbin copy', () => {
  it('names the domain for a public document of a verified owner, on the app page and on /raw', async () => {
    const w = await world();
    const page = await app().request(`${APP}/@vivek/${w.post.id}-hello-world`, { headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`<link rel="canonical" href="https://blog.example.org/${w.post.id}-hello-world">`);
    const raw = await app().request(`${APP}/a/${w.post.id}/raw`);
    expect(await raw.text()).toContain(`<link rel="canonical" href="https://blog.example.org/${w.post.id}-hello-world">`);
  });

  it('names its own app address for an unlisted document, another owner\'s, and once the domain is removed', async () => {
    const w = await world();
    const quiet = await app().request(`${APP}/a/${w.quiet.id}/raw`);
    expect(await quiet.text()).toContain(`<link rel="canonical" href="${APP}/@vivek/${w.quiet.id}-unlisted-draft">`);
    const theirs = await app().request(`${APP}/@stranger/${w.theirs.id}-stranger-post`, { headers: { accept: 'text/html' } });
    expect(await theirs.text()).toContain(`<link rel="canonical" href="${APP}/@stranger/${w.theirs.id}-stranger-post">`);
    await removeDomain(w.vivek.userId);
    const after = await app().request(`${APP}/a/${w.post.id}/raw`);
    expect(await after.text()).toContain(`<link rel="canonical" href="${APP}/@vivek/${w.post.id}-hello-world">`);
  });
});

describe('the certificate ask check', () => {
  it('answers 200 for a verified host and 404 otherwise, whatever the flag says', async () => {
    const w = await world();
    const ask = (domain: string) => app().request(`${APP}/api/domains/allow?domain=${encodeURIComponent(domain)}`);
    settings.target = null;
    const yes = await ask('blog.example.org');
    expect(yes.status).toBe(200);
    noCookie(yes);
    expect((await ask('BLOG.example.org')).status).toBe(200);
    for (const no of ['pending.example.org', 'unknown.example.org', '', 'app.example.test', '203.0.113.10']) expect((await ask(no)).status, no).toBe(404);
    expect((await app().request(`${APP}/api/domains/allow`)).status).toBe(404);
    await removeDomain(w.vivek.userId);
    expect((await ask('blog.example.org')).status).toBe(404);
  });
});

describe('the settings API', () => {
  const call = (method: string, path: string, body?: unknown) => app().request(`${APP}${path}`, {
    method, headers: { 'content-type': 'application/json', origin: APP }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  it('needs a signed-in account', async () => {
    for (const [method, path] of [['GET', '/api/my/domain'], ['POST', '/api/my/domain'], ['DELETE', '/api/my/domain'], ['POST', '/api/my/domain/verify']] as const) {
      expect((await call(method, path, method === 'POST' ? { hostname: 'x.example.org' } : undefined)).status, `${method} ${path}`).toBe(401);
    }
  });

  it('attaches, reports, verifies with a named failure, verifies, and removes', async () => {
    const me = await owner('settings');
    settings.session = me.userId;
    const dns = { token: '', pointing: false };
    setDomainResolver({
      txt: async (name) => (name === '_artifactbin.blog.example.org' && dns.token ? [dns.token] : []),
      addresses: async (name) => (name === 'domains.example.test' || (dns.pointing && name === 'blog.example.org') ? [TARGET_IP] : []),
      caa: async () => [],
    });
    expect(await (await call('GET', '/api/my/domain')).json()).toEqual({ enabled: true, target: 'domains.example.test', targetAddresses: [TARGET_IP], domain: null });
    const attached = await call('POST', '/api/my/domain', { hostname: 'Blog.Example.org' });
    expect(attached.status).toBe(201);
    const domain = await attached.json();
    expect(domain).toMatchObject({ hostname: 'blog.example.org', status: 'pending', txtName: '_artifactbin.blog.example.org' });
    expect((await call('POST', '/api/my/domain', { hostname: 'other.example.org' })).status).toBe(409);
    expect(await (await call('POST', '/api/my/domain', { hostname: 'app.example.test' })).json()).toEqual({ error: 'invalid_hostname' });

    const missing = await call('POST', '/api/my/domain/verify', { hostname: 'blog.example.org' });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toEqual({ error: 'txt_missing' });
    dns.token = domain.txtValue;
    expect(await (await call('POST', '/api/my/domain/verify', { hostname: 'blog.example.org' })).json()).toEqual({ error: 'not_pointing' });
    dns.pointing = true;
    const ok = await call('POST', '/api/my/domain/verify', { hostname: 'blog.example.org' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'verified' });

    // Flag off: attaching and verifying are refused, but the owner still sees and removes it.
    settings.target = null;
    expect(await (await call('GET', '/api/my/domain')).json()).toMatchObject({ enabled: false, target: null, domain: { hostname: 'blog.example.org', status: 'verified' } });
    expect((await call('POST', '/api/my/domain', { hostname: 'blog.example.org' })).status).toBe(403);
    expect((await call('POST', '/api/my/domain/verify', { hostname: 'blog.example.org' })).status).toBe(403);
    expect((await call('DELETE', '/api/my/domain')).status).toBe(204);
    expect(await (await call('GET', '/api/my/domain')).json()).toMatchObject({ enabled: false, domain: null });
  });

  it('refuses a cross-site write riding the session', async () => {
    const me = await owner('csrf');
    settings.session = me.userId;
    const res = await app().request(`${APP}/api/my/domain`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ hostname: 'blog.example.org' }) });
    expect(res.status).toBe(403);
  });
});
