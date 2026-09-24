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
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
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
import { fakeBrowser } from '@artifactbin/utils';
import { getArtifactById } from '@/lib/artifacts';
import { setAvatar } from '@/lib/avatars';
import { resetExportRenderer } from '@/lib/export';
import { setServices } from '@/lib/services';
import { ProfileListing } from '@/web/pages/Profile';
import { attachDomain, removeDomain, setDomainResolver, verifyDomain, type DomainResolver } from '@/lib/custom-domains';
import { mintToken } from '@/lib/tokens';
import { getDb } from '@/lib/db';
import { objectKey, objectStore } from '@/lib/object-store';
import { urlHash } from '@/lib/story/asset-url';
import { claimToken, createUser, setUsername } from '@/lib/users';
import { createAppServer } from '../app';

useAppHarness();

const APP = 'https://app.example.test';
const HOST = 'https://blog.example.org';
const TARGET_IP = '203.0.113.10';
/** The SPA's shell, with the stylesheet the app page links (web/index.html). */
const SHELL = '<!doctype html><html><head><title>artifactbin</title><link rel="stylesheet" href="/shell.css" /></head><body><div id="root"></div></body></html>';
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
  it('lists the owner\'s public root documents, server-rendered with links and the footer, and nothing private', async () => {
    const w = await world();
    const res = await app().request(`${HOST}/`, { headers: { accept: 'text/html', cookie: 'mx_session=anything' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    noCookie(res);
    const html = await res.text();
    expect(html).toContain(`href="/${w.post.id}-hello-world"`);
    expect(html).toContain('Hello World');
    // The profile's own data: its root, with no folder tile (a folder page is
    // not served here), so a filed post is reached at its own address only.
    for (const hidden of ['Unlisted draft', 'Private plan', 'Stranger post', 'Notes', 'Filed post']) expect(html).not.toContain(hidden);
    for (const id of [w.quiet.id, w.secret.id, w.theirs.id, w.folder.id, w.filed.id]) expect(html).not.toContain(id);
    expect(html).toContain('<link rel="canonical" href="https://blog.example.org/">');
    expect(html).toMatch(/Made with <a href="https:\/\/app\.example\.test\/@vivek"[^>]*>artifactbin<\/a>/);
    expect(html).toContain('<title>');
    // No app shell: no SPA root, no bootstrap, no script but the theme stamp, no app navigation or Follow.
    expect(html).not.toContain('id="root"');
    expect(html.match(/<script\b/gi)).toHaveLength(1);
    expect(html).not.toMatch(/aria-label="(?:Follow|Unfollow|Search artifacts|Grid view)"/);
    expect(html).not.toContain('/login');
    expect(html).not.toContain('/@vivek/');
    expect((await app().request(`${HOST}/`, { method: 'HEAD' })).status).toBe(200);
  });

  it('is the same ProfileListing a guest gets on /@handle: the same markup, less Follow and the toolbar, with host addresses', async () => {
    const maya = await owner('maya');
    const first = await create(maya.token, { markup: '<h1>One</h1>', title: 'First Light', description: 'Morning notes', visibility: 'public' });
    const second = await create(maya.token, { markup: '<h1>Two</h1>', title: 'Second Wind', visibility: 'public' });
    await create(maya.token, { markup: '<h1>Q</h1>', title: 'Quiet one', visibility: 'unlisted' });
    await create(maya.token, { markup: '<h1>S</h1>', title: 'Secret one', visibility: 'private' });
    await verified(maya.userId, 'maya.example.org');

    // The app's answer for a guest, through the real route, drawn by the component /@maya mounts.
    const data = await (await app().request(`${APP}/api/page/profile/@maya`)).json();
    expect(data.kind).toBe('public-profile');
    const expected = new JSDOM(renderToStaticMarkup(createElement(ProfileListing, { data }))).window.document.body;
    // The documented differences, and nothing else:
    // no Follow (it needs a session and /api)…
    const follow = expected.querySelector('[aria-label="Follow"]');
    expect(follow).not.toBeNull();
    follow!.remove();
    // …no search/filter/view toolbar (controls that need the SPA's script)…
    const toolbar = expected.querySelector('section[aria-label="Shelf"] > div');
    expect(toolbar?.querySelector('[aria-label="Search artifacts"]')).not.toBeNull();
    toolbar!.remove();
    // …and addresses on this host instead of the app's.
    for (const link of expected.querySelectorAll('a[href]')) link.setAttribute('href', link.getAttribute('href')!.replace(/^\/@maya(?:\/|$)/, '/'));

    const page = await app().request('https://maya.example.org/', { headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    const html = await page.text();
    const listing = new JSDOM(html).window.document.querySelector('main');
    expect(listing).not.toBeNull();
    expect(listing!.innerHTML).toBe(expected.innerHTML);
    expect(html).toContain(`href="/${first.id}-first-light"`);
    expect(html).toContain(`href="/${second.id}-second-wind"`);
    expect(html).not.toMatch(/Quiet one|Secret one/);
  });

  it('links the stylesheet the app page links, and its policy admits only this host\'s styles, fonts and images', async () => {
    await world();
    const hrefs = (html: string) => [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map((m) => /href="([^"]+)"/.exec(m[0])?.[1]);
    const spa = await (await app().request(`${APP}/login`, { headers: { accept: 'text/html' } })).text();
    expect(hrefs(spa)).toEqual(['/shell.css']);
    const res = await app().request(`${HOST}/`, { headers: { accept: 'text/html' } });
    expect(hrefs(await res.text())).toEqual(hrefs(spa));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/style-src 'self'/);
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toMatch(/https?:/);
  });

  it('follows the theme the way the app page does: web/index.html\'s own stamp, admitted by its hash and nothing else', async () => {
    await world();
    // Parsed, not pattern-matched: the browser's own reading of each document.
    const shell = new JSDOM(readFileSync(join(__dirname, '..', '..', 'web', 'index.html'), 'utf8')).window.document;
    const stamps = [...shell.querySelectorAll('script:not([src])')].map((script) => script.textContent ?? '');
    expect(stamps).toHaveLength(1);
    const res = await app().request(`${HOST}/`, { headers: { accept: 'text/html' } });
    const page = new JSDOM(await res.text()).window.document;
    const scripts = [...page.querySelectorAll('script')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.hasAttribute('src')).toBe(false);
    expect(scripts[0]!.textContent).toBe(stamps[0]);
    // Before paint: in the head, ahead of the stylesheet.
    expect(scripts[0]!.parentElement?.tagName).toBe('HEAD');
    const stylesheet = page.querySelector('link[rel="stylesheet"]')!;
    expect(scripts[0]!.compareDocumentPosition(stylesheet) & 4 /* FOLLOWING */).toBeTruthy();
    const hash = createHash('sha256').update(stamps[0]!, 'utf8').digest('base64');
    const scriptSrc = (res.headers.get('content-security-policy') ?? '').split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe(`script-src 'sha256-${hash}'`);
  });

  it('serves the built stylesheet and its fonts on the host, never a script', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'domain-home-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" crossorigin href="/assets/shell-Ab12cd.css"><script type="module" crossorigin src="/assets/main-Cd34ef.js"></script></head><body><div id="root"></div></body></html>');
    writeFileSync(join(dir, 'assets', 'shell-Ab12cd.css'), 'body{color:red}');
    writeFileSync(join(dir, 'assets', 'main-Cd34ef.js'), 'console.log(1)');
    writeFileSync(join(dir, 'assets', 'plex-Ef56ab.woff2'), 'wOF2');
    mkdirSync(join(dir, '.vite'));
    writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'main.tsx': { file: 'assets/main-Cd34ef.js', css: ['assets/shell-Ab12cd.css'], assets: ['assets/plex-Ef56ab.woff2'] } }));
    const built = createAppServer({ webDir: dir });
    await world();
    const html = await (await built.request(`${HOST}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('href="/assets/shell-Ab12cd.css"');
    expect(html).not.toContain('main-Cd34ef.js');
    const css = await built.request(`${HOST}/assets/shell-Ab12cd.css`, { headers: { cookie: 'mx_session=anything' } });
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    noCookie(css);
    expect((await built.request(`${HOST}/assets/plex-Ef56ab.woff2`)).status).toBe(200);
    expect((await built.request(`${HOST}/assets/plex-Ef56ab.woff2`, { method: 'HEAD' })).status).toBe(200);
    for (const path of ['/assets/main-Cd34ef.js', '/assets/missing-Zz99yy.css', '/index.html']) expect((await built.request(`${HOST}${path}`)).status, path).toBe(404);
    expect((await built.request(`${HOST}/assets/shell-Ab12cd.css`, { method: 'POST' })).status).toBe(404);
    // The manifest-checked door the proxy asks first (BUILD_ASSET_PATH) answers the same way on this host.
    expect((await built.request(`${HOST}/api/internal/build-assets/assets/shell-Ab12cd.css`)).status).toBe(200);
    expect((await built.request(`${HOST}/api/internal/build-assets/assets/main-Cd34ef.js`)).status).toBe(404);
  });
});

/** What the fake browser photographs: any decodable image will do (lib/export reads its size). */
const shot = () => new Uint8Array(PNG);
const unescapeAttr = (value: string) => value.replace(/&amp;/g, '&');

describe('card thumbnails and the owner\'s picture on a verified host', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  beforeEach(async () => {
    await resetExportRenderer();
    browser = fakeBrowser({ ok: true, mime: 'image/jpeg', bytes: shot() });
    setServices({ browser });
  });
  afterEach(() => setServices({}));

  it('serves the card image of a listed post, as bytes, to a guest; nothing else is exported', async () => {
    const w = await world();
    const html = await (await app().request(`${HOST}/`, { headers: { accept: 'text/html' } })).text();
    const src = new RegExp(`/a/${w.post.id}/export\\?[^"]+`).exec(html)?.[0];
    expect(src, 'the card thumbnail Shelf draws').toBeTruthy();
    const url = unescapeAttr(src!);
    expect(url).toMatch(/format=jpg&mode=card&v=\d+&r=\d+$/);
    const card = await app().request(`${HOST}${url}`, { headers: { cookie: 'mx_session=anything' } });
    expect(card.status, await card.clone().text()).toBe(200);
    expect(card.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await card.arrayBuffer())).toEqual(shot());
    noCookie(card);
    const head = await app().request(`${HOST}${url}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    // A forced re-render is not the reader's to ask for: the cached card answers.
    expect((await app().request(`${HOST}${url}&refresh=1`)).status).toBe(200);
    expect(browser.calls).toHaveLength(1);

    const query = url.slice(url.indexOf('?'));
    for (const id of [w.quiet.id, w.secret.id, w.theirs.id, w.folder.id, w.ds.id, 'zzzzzz']) {
      const res = await app().request(`${HOST}/a/${id}/export${query}`);
      expect(res.status, id).toBe(404);
      noCookie(res);
    }
    for (const other of ['?mode=card', '?format=png&mode=card', '?format=jpg&mode=full', '?format=jpg', '?format=jpg&mode=preview']) {
      expect((await app().request(`${HOST}/a/${w.post.id}/export${other}`)).status, other).toBe(404);
    }
    expect((await app().request(`${HOST}${url}`, { method: 'POST' })).status).toBe(404);
  });

  it('serves the owner\'s picture the hero draws, and no other account\'s', async () => {
    const w = await world();
    await setAvatar(w.vivek.userId, PNG, 'image/png');
    await setAvatar(w.other.userId, PNG, 'image/png');
    const html = await (await app().request(`${HOST}/`, { headers: { accept: 'text/html' } })).text();
    const src = new RegExp(`/api/users/${w.vivek.userId}/avatar\\?v=[^"]+`).exec(html)?.[0];
    expect(src, 'the hero draws the owner\'s picture').toBeTruthy();
    const picture = await app().request(`${HOST}${unescapeAttr(src!)}`, { headers: { cookie: 'mx_session=anything' } });
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toMatch(/^image\//);
    noCookie(picture);
    expect((await app().request(`${HOST}${unescapeAttr(src!)}`, { method: 'HEAD' })).status).toBe(200);
    expect((await app().request(`${HOST}/api/users/${w.other.userId}/avatar`)).status).toBe(404);
    expect((await app().request(`${HOST}/api/users/${w.vivek.userId}/follow`, { method: 'POST' })).status).toBe(404);
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
    // The document keeps its own layout styles (in the head); no reader-chrome ELEMENT is rendered in the body.
    const markup = html.slice(html.indexOf('<body'));
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function upload(token: string, visibility: string) {
  const res = await createRoute(new Request(`http://localhost:3000/api/artifacts?visibility=${visibility}`, {
    method: 'POST', headers: { 'content-type': 'image/png', authorization: `Bearer ${token}` }, body: new Uint8Array(PNG),
  }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
}
/** A web image we already hold a copy of, as publish leaves it: our bytes at /assets/<sha of its url>. */
async function heldWebImage(url: string) {
  const key = objectKey('webasset', Buffer.concat([PNG, Buffer.from(url)]));
  await objectStore().put(key, PNG, 'image/png');
  await (await getDb()).query('INSERT INTO web_assets (url_hash, url, object_key, content_type, bytes) VALUES ($1, $2, $3, $4, $5)', [urlHash(url), url, key, 'image/png', PNG.length]);
  return urlHash(url);
}

describe('images in posts on a verified host', () => {
  it('serves the uploaded and the web images a public post embeds, and no other artifact bytes', async () => {
    const w = await world();
    const pic = await upload(w.vivek.token, 'unlisted');
    const loose = await upload(w.vivek.token, 'public');
    const quietPic = await upload(w.vivek.token, 'unlisted');
    const theirPic = await upload(w.other.token, 'public');
    const webHash = await heldWebImage('https://cdn.example.test/cover.png');
    const strayHash = await heldWebImage('https://cdn.example.test/stray.png');
    const post = await create(w.vivek.token, { title: 'Pictures', visibility: 'public',
      markup: `<h1>Pictures</h1><img src="ref:${pic.id}" alt="uploaded" /><img src="https://cdn.example.test/cover.png" alt="from the web" />` });
    await create(w.vivek.token, { title: 'Quiet pictures', visibility: 'unlisted', markup: `<img src="ref:${quietPic.id}" alt="quiet" />` });
    await create(w.other.token, { title: 'Their pictures', visibility: 'public', markup: `<img src="ref:${theirPic.id}" alt="theirs" />` });

    const html = await (await app().request(`${HOST}/${post.id}-pictures`)).text();
    const src = new RegExp(`/a/${pic.id}/raw\\?v=\\d+`).exec(html)?.[0];
    expect(src, 'the uploaded image is served from /a/<id>/raw').toBeTruthy();
    expect(html).toContain(`/assets/${webHash}`);

    const image = await app().request(`${HOST}${src}`, { headers: { cookie: 'mx_session=anything' } });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toMatch(/^image\//);
    noCookie(image);
    expect((await app().request(`${HOST}${src}`, { method: 'HEAD' })).status).toBe(200);
    const web = await app().request(`${HOST}/assets/${webHash}`);
    expect(web.status).toBe(200);
    expect(web.headers.get('content-type')).toBe('image/png');

    // Bytes no public post of the owner embeds stay 404: an unreferenced upload,
    // one only an unlisted document embeds, another owner's, a stray web copy,
    // and every markup document's own /raw.
    for (const path of [`/a/${loose.id}/raw`, `/a/${quietPic.id}/raw`, `/a/${theirPic.id}/raw`, `/assets/${strayHash}`, `/a/${post.id}/raw`, `/a/${w.post.id}/raw`, `/a/${w.ds.id}/raw`]) {
      expect((await app().request(`${HOST}${path}`)).status, path).toBe(404);
    }
    const write = await app().request(`${HOST}/a/${pic.id}/raw`, { method: 'POST' });
    expect(write.status).toBe(404);
    // The app copy's rule holds too: once the image is private a guest cannot read it, here or there.
    await (await getDb()).query("UPDATE artifacts SET visibility = 'private' WHERE id = $1", [pic.id]);
    expect((await app().request(`${APP}${src}`)).status).toBe(404);
    expect((await app().request(`${HOST}${src}`)).status).toBe(404);
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
