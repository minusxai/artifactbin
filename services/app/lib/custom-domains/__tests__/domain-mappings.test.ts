/**
 * WHAT A CUSTOM DOMAIN SERVES, as rules: which request hosts can be one, which owner a host serves, the homepage
 * and exact-path mappings (set, change, clear, refused), what bytes a host may embed, and the canonical address of
 * an artifactbin copy. Attaching, verifying and the re-check are lib/__tests__/custom-domains'; the HTTP around the
 * settings API and the host itself is server/__tests__/custom-domain-host's.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createArtifact, type ArtifactRow } from '@/lib/artifacts';
import { createUser, setUsername } from '@/lib/accounts';
import { urlHash } from '@/lib/document';
import { getDb } from '@/lib/platform';
import { overrideConfig } from '@/lib/platform/config';
import { attachDomain, canonicalDocumentUrl, customHostCandidate, domainHomepage, domainHomepageOptions, domainPath, isServable, ownerForHost, removeDomain, servesDocument, servesEmbeddedArtifact, servesWebAsset, setDomainHomepage, setDomainPath, verifyDomain, type DomainResolver } from '@/lib/custom-domains';

useAppHarness();
const APP = 'https://app.example.test';
const HOST = 'blog.example.org';
const TARGET_IP = '203.0.113.10';
beforeEach(() => overrideConfig({
  customDomainsTarget: 'domains.example.test', publicBaseUrl: APP,
  aliasOrigins: ['https://www.example-alias.test'], assetsOrigin: 'https://assets.example.test',
}));

const agreeing = (hostname: string, token: string): DomainResolver => ({
  txt: async (name) => (name === `_artifactbin.${hostname}` ? [token] : []),
  addresses: async (name) => (name === hostname || name === 'domains.example.test' ? [TARGET_IP] : []),
  caa: async () => [],
});

async function account(name: string): Promise<string> {
  const user = await createUser({ email: `${name}@example.com` });
  await setUsername(user.id, name);
  return user.id;
}
async function attach(userId: string, hostname = HOST, verify = true): Promise<void> {
  const attached = await attachDomain(userId, hostname);
  if ('error' in attached) throw new Error(attached.error);
  if (!verify) return;
  const done = await verifyDomain(userId, hostname, agreeing(hostname, attached.txtValue));
  if ('error' in done) throw new Error(done.error);
}
const doc = (userId: string, title: string, visibility: 'public' | 'unlisted' | 'private' = 'public', extra: Partial<Parameters<typeof createArtifact>[2]> = {}) =>
  createArtifact(null, userId, { format: 'html', title, description: null, source: `<html><head></head><body><h1>${title}</h1></body></html>`, meta: {}, visibility, ...extra });

/** One owner with a verified domain and every kind of row the mapping rules tell apart, plus a stranger. */
async function world() {
  const owner = await account('vivek');
  const other = await account('stranger');
  const post = await doc(owner, 'Hello World');
  const second = await doc(owner, 'Second post');
  const folder = await createArtifact(null, owner, { format: 'folder', title: 'Notes', description: null, source: null, meta: {}, visibility: 'public' });
  const filed = await doc(owner, 'Filed post', 'public', { ancestor_ids: [folder.id] });
  const quiet = await doc(owner, 'Unlisted draft', 'unlisted');
  const secret = await doc(owner, 'Private plan', 'private');
  const dataset = await createArtifact(null, owner, { format: 'dataset', title: 'Rows', description: null, source: '[{"a":1}]', meta: {}, visibility: 'public' });
  const theirs = await doc(other, 'Stranger post');
  await attach(owner);
  return { owner, other, post, second, folder, filed, quiet, secret, dataset, theirs };
}
type World = Awaited<ReturnType<typeof world>>;
const ineligible = (w: World) => ({ unlisted: w.quiet.id, private: w.secret.id, 'another owner\'s': w.theirs.id, dataset: w.dataset.id, folder: w.folder.id, missing: 'Zz99Zz99' });
const update = async (sql: string, values: unknown[]) => (await getDb()).query(sql, values);

describe('which request hosts could be a custom domain', () => {
  it('normalizes a candidate: case, a trailing dot', () => {
    expect(customHostCandidate('Blog.Example.ORG.')).toBe(HOST);
    expect(customHostCandidate(HOST)).toBe(HOST);
  });

  it('is never one of ours: the app, an alias, the assets host, the DNS target, or any name under them', () => {
    for (const host of ['app.example.test', 'APP.example.test', 'docs.app.example.test', 'www.example-alias.test', 'a.www.example-alias.test', 'assets.example.test', 'domains.example.test', 'x.domains.example.test']) {
      expect(customHostCandidate(host), host).toBeNull();
    }
  });

  it('may be a parent of ours: only our own names and the names under them are claimed', () => {
    expect(customHostCandidate('example.test')).toBe('example.test');
    expect(customHostCandidate('example-alias.test')).toBe('example-alias.test');
  });

  it('is never a malformed host: a port, an IP, a single label, a path, a wildcard or empty', () => {
    for (const host of ['blog.example.org:443', '203.0.113.10', '[2001:db8::1]', 'localhost', 'blog.example.org/x', '*.example.org', '', ' ', 'example.123']) {
      expect(customHostCandidate(host), host).toBeNull();
    }
  });

  it('lets a single-label own host claim only itself, never names under it', () => {
    overrideConfig({ publicBaseUrl: 'http://localhost:3030', aliasOrigins: [], assetsOrigin: null, customDomainsTarget: null });
    expect(customHostCandidate('localhost')).toBeNull();
    expect(customHostCandidate('preview.localhost')).toBe('preview.localhost');
  });

  it('reads the configuration at call time', () => {
    expect(customHostCandidate('new.example.net')).toBe('new.example.net');
    overrideConfig({ aliasOrigins: ['https://new.example.net'] });
    expect(customHostCandidate('new.example.net')).toBeNull();
  });
});

describe('which owner a host serves', () => {
  it('only a VERIFIED host serves its owner; a pending, unknown or malformed one serves nobody', async () => {
    const verified = await account('verified');
    const pending = await account('pending');
    await attach(verified);
    await attach(pending, 'pending.example.org', false);
    expect(await ownerForHost(HOST)).toBe(verified);
    expect(await ownerForHost('BLOG.example.org.')).toBe(verified);
    for (const host of ['pending.example.org', 'unknown.example.org', 'blog.example.org:443', '', 'app.example.test']) {
      expect(await ownerForHost(host), host).toBeNull();
      expect(await isServable(host), host).toBe(false);
    }
    expect(await isServable(HOST)).toBe(true);
    await removeDomain(verified);
    expect(await ownerForHost(HOST)).toBeNull();
  });
});

describe('the homepage', () => {
  it('lists the owner\'s public live documents as options, inside folders too, ordered by title', async () => {
    const w = await world();
    expect(await domainHomepageOptions(w.owner)).toEqual([
      { id: w.filed.id, title: 'Filed post' }, { id: w.post.id, title: 'Hello World' }, { id: w.second.id, title: 'Second post' },
    ]);
    await update('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [w.second.id]);
    expect((await domainHomepageOptions(w.owner)).map((o) => o.id)).toEqual([w.filed.id, w.post.id]);
    expect(await domainHomepageOptions(w.other)).toEqual([{ id: w.theirs.id, title: 'Stranger post' }]);
  });

  it('sets one, serves it at the root, changes it and clears it', async () => {
    const w = await world();
    expect(await domainHomepage(w.owner)).toBeNull();
    expect(await setDomainHomepage(w.owner, w.post.id)).toMatchObject({ hostname: HOST, homepageArtifactId: w.post.id });
    expect((await domainHomepage(w.owner))?.id).toBe(w.post.id);
    expect(await setDomainHomepage(w.owner, w.filed.id)).toMatchObject({ homepageArtifactId: w.filed.id });
    expect((await domainHomepage(w.owner))?.id).toBe(w.filed.id);
    expect(await setDomainHomepage(w.owner, null)).toMatchObject({ homepageArtifactId: null });
    expect(await domainHomepage(w.owner)).toBeNull();
  });

  it('refuses every document but the owner\'s public live markup, and keeps the saved one', async () => {
    const w = await world();
    await setDomainHomepage(w.owner, w.post.id);
    for (const [kind, id] of Object.entries(ineligible(w))) expect(await setDomainHomepage(w.owner, id), kind).toEqual({ error: 'invalid_homepage' });
    await update('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [w.second.id]);
    expect(await setDomainHomepage(w.owner, w.second.id)).toEqual({ error: 'invalid_homepage' });
    expect((await domainHomepage(w.owner))?.id).toBe(w.post.id);
  });

  it('is `not_found` for an account with no domain, even to clear, and never touches another account\'s domain', async () => {
    const w = await world();
    expect(await setDomainHomepage(w.other, w.theirs.id)).toEqual({ error: 'not_found' });
    expect(await setDomainHomepage(w.other, null)).toEqual({ error: 'not_found' });
    expect(await setDomainHomepage(w.other, w.post.id)).toEqual({ error: 'not_found' });
    expect(await domainHomepage(w.owner)).toBeNull();
  });

  it('is resolved anew: a homepage made private, unlisted, trashed or handed over falls back to the listing', async () => {
    const w = await world();
    await setDomainHomepage(w.owner, w.post.id);
    for (const change of ["visibility = 'private'", "visibility = 'unlisted'", 'deleted_at = now()', 'user_id = $2']) {
      await update(`UPDATE artifacts SET ${change} WHERE id = $1`, change.includes('$2') ? [w.post.id, w.other] : [w.post.id]);
      expect(await domainHomepage(w.owner), change).toBeNull();
      await update("UPDATE artifacts SET visibility = 'public', deleted_at = NULL, user_id = $2 WHERE id = $1", [w.post.id, w.owner]);
      expect((await domainHomepage(w.owner))?.id, change).toBe(w.post.id);
    }
  });
});

describe('exact paths', () => {
  it('maps, lists sorted, changes and clears one path at a time, leaving the others and the homepage alone', async () => {
    const w = await world();
    await setDomainHomepage(w.owner, w.post.id);
    expect(await setDomainPath(w.owner, '/guides/start', w.second.id)).toMatchObject({ pathOverrides: [{ path: '/guides/start', artifactId: w.second.id }] });
    const both = await setDomainPath(w.owner, '/about', w.filed.id);
    expect(both).toMatchObject({ homepageArtifactId: w.post.id, pathOverrides: [{ path: '/about', artifactId: w.filed.id }, { path: '/guides/start', artifactId: w.second.id }] });
    expect((await domainPath(w.owner, '/about'))?.artifact?.id).toBe(w.filed.id);
    expect(await setDomainPath(w.owner, '/about', w.post.id)).toMatchObject({ pathOverrides: [{ path: '/about', artifactId: w.post.id }, { path: '/guides/start', artifactId: w.second.id }] });
    expect(await setDomainPath(w.owner, '/about', null)).toMatchObject({ homepageArtifactId: w.post.id, pathOverrides: [{ path: '/guides/start', artifactId: w.second.id }] });
    expect(await domainPath(w.owner, '/about')).toBeNull();
    // Clearing a path that was never mapped is not an error, and changes nothing.
    expect(await setDomainPath(w.owner, '/never', null)).toMatchObject({ pathOverrides: [{ path: '/guides/start', artifactId: w.second.id }] });
  });

  it('is exact and case-sensitive', async () => {
    const w = await world();
    await setDomainPath(w.owner, '/About', w.post.id);
    expect((await domainPath(w.owner, '/About'))?.artifact?.id).toBe(w.post.id);
    for (const path of ['/about', '/About/', '/About/x', '/Abou']) expect(await domainPath(w.owner, path), path).toBeNull();
  });

  it('refuses malformed and reserved paths before reading anything', async () => {
    const w = await world();
    const refused = ['/', '', 'about', '//about', '/about/', '/hello world', '/about?x=1', '/about#top', '/%61', '/x/../about', '/x\\about', '/favicon.ico',
      '/a', '/a/doc', '/api', '/API/x', '/assets/photo', '/islands/x', '/story/x', '/fonts/x', '/libraries/x', '/geojson/x', `/${'x'.repeat(200)}`];
    for (const path of refused) {
      expect(await setDomainPath(w.owner, path, w.post.id), path).toEqual({ error: 'invalid_path' });
      expect(await domainPath(w.owner, path), path).toBeNull();
    }
    // A reserved word is reserved as a segment, not as a prefix.
    for (const path of ['/api-docs', '/apis', '/about', '/a-b/c_d', `/${'x'.repeat(199)}`]) expect(await setDomainPath(w.owner, path, w.post.id), path).not.toHaveProperty('error');
  });

  it('refuses every document but the owner\'s public live markup, and keeps the mapping it had', async () => {
    const w = await world();
    await setDomainPath(w.owner, '/about', w.post.id);
    for (const [kind, id] of Object.entries(ineligible(w))) expect(await setDomainPath(w.owner, '/about', id), kind).toEqual({ error: 'invalid_document' });
    expect((await domainPath(w.owner, '/about'))?.artifact?.id).toBe(w.post.id);
  });

  it('is `not_found` for an account with no domain, whatever the document', async () => {
    const w = await world();
    expect(await setDomainPath(w.other, '/about', w.theirs.id)).toEqual({ error: 'not_found' });
    expect(await setDomainPath(w.other, '/about', null)).toEqual({ error: 'not_found' });
    expect(await domainPath(w.other, '/about')).toBeNull();
  });

  it('holds 50 paths: a new one past that is `path_limit`, while existing ones still change and clear', async () => {
    const w = await world();
    const paths = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`/page-${i}`, w.post.id]));
    await update('UPDATE custom_domains SET path_overrides = $2::jsonb WHERE user_id = $1', [w.owner, JSON.stringify(paths)]);
    expect(await setDomainPath(w.owner, '/extra', w.post.id)).toEqual({ error: 'path_limit' });
    expect(await setDomainPath(w.owner, '/page-0', w.second.id)).not.toHaveProperty('error');
    expect(await setDomainPath(w.owner, '/page-0', w.quiet.id)).toEqual({ error: 'invalid_document' });
    expect(await setDomainPath(w.owner, '/page-1', null)).not.toHaveProperty('error');
    expect(await setDomainPath(w.owner, '/extra', w.post.id)).not.toHaveProperty('error');
  });

  it('keeps claiming its URL when its document becomes unavailable: the path answers no artifact rather than nothing', async () => {
    const w = await world();
    await setDomainPath(w.owner, '/about', w.post.id);
    for (const change of ["visibility = 'private'", "visibility = 'unlisted'", 'deleted_at = now()', 'user_id = $2']) {
      await update(`UPDATE artifacts SET ${change} WHERE id = $1`, change.includes('$2') ? [w.post.id, w.other] : [w.post.id]);
      expect(await domainPath(w.owner, '/about'), change).toEqual({ artifact: null });
      await update("UPDATE artifacts SET visibility = 'public', deleted_at = NULL, user_id = $2 WHERE id = $1", [w.post.id, w.owner]);
    }
    expect((await domainPath(w.owner, '/about'))?.artifact?.id).toBe(w.post.id);
  });

  it('goes with the domain: removing and re-attaching starts with no mappings', async () => {
    const w = await world();
    await setDomainHomepage(w.owner, w.post.id);
    await setDomainPath(w.owner, '/about', w.post.id);
    await removeDomain(w.owner);
    await attach(w.owner);
    expect(await domainPath(w.owner, '/about')).toBeNull();
    expect(await domainHomepage(w.owner)).toBeNull();
  });
});

describe('what a host may serve', () => {
  it('serves a document only when it is the owner\'s, public, markup and not trashed', () => {
    const row = { user_id: 'usr_1', visibility: 'public', format: 'html' } as const;
    expect(servesDocument('usr_1', row)).toBe(true);
    expect(servesDocument('usr_2', row)).toBe(false);
    for (const visibility of ['unlisted', 'private'] as const) expect(servesDocument('usr_1', { ...row, visibility }), visibility).toBe(false);
    for (const format of ['folder', 'dataset', 'image', 'markup']) expect(servesDocument('usr_1', { ...row, format } as typeof row), format).toBe(false);
    expect(servesDocument('usr_1', { ...row, deleted_at: new Date() })).toBe(false);
  });

  it('embeds an upload only when one of the owner\'s public documents references it and a guest may read it', async () => {
    const owner = await account('embedder');
    const other = await account('elsewhere');
    const image = (visibility: 'public' | 'unlisted' | 'private', userId = owner) =>
      createArtifact(null, userId, { format: 'image', title: 'img', description: null, source: null, meta: { contentType: 'image/png' }, visibility });
    const [shown, unlistedImage, hidden, unreferenced, quietOnly, foreign] = await Promise.all([image('public'), image('unlisted'), image('private'), image('public'), image('public'), image('public', other)]);
    const refs = (...rows: ArtifactRow[]) => ({ refs: rows.map((r) => ({ id: r.id, kind: 'image' })) });
    await doc(owner, 'Post', 'public', { meta: refs(shown, unlistedImage, hidden, foreign) });
    await doc(owner, 'Quiet', 'unlisted', { meta: refs(quietOnly) });
    const post = await doc(owner, 'Markup is never embedded', 'public');
    await doc(owner, 'Refers to markup', 'public', { meta: refs(post) });
    expect(await servesEmbeddedArtifact(owner, shown)).toBe(true);
    expect(await servesEmbeddedArtifact(owner, unlistedImage)).toBe(true);
    expect(await servesEmbeddedArtifact(owner, foreign)).toBe(true);
    expect(await servesEmbeddedArtifact(owner, hidden)).toBe(false);
    expect(await servesEmbeddedArtifact(owner, unreferenced)).toBe(false);
    expect(await servesEmbeddedArtifact(owner, quietOnly)).toBe(false);
    expect(await servesEmbeddedArtifact(owner, post)).toBe(false);
    expect(await servesEmbeddedArtifact(other, shown)).toBe(false);
  });

  it('serves a web image copy only when one of the owner\'s public documents names its URL', async () => {
    const owner = await account('webimages');
    const shown = 'https://cdn.example.test/shown.png', quiet = 'https://cdn.example.test/quiet.png', linked = 'https://cdn.example.test/linked.png';
    await doc(owner, 'Post', 'public', { source: `<html><body><img src="${shown}"><a href="${linked}">link</a></body></html>` });
    await doc(owner, 'Quiet', 'unlisted', { source: `<html><body><img src="${quiet}"></body></html>` });
    expect(await servesWebAsset(owner, urlHash(shown))).toBe(true);
    expect(await servesWebAsset(owner, urlHash(quiet))).toBe(false);
    expect(await servesWebAsset(owner, urlHash(linked))).toBe(false);
    expect(await servesWebAsset(owner, 'f'.repeat(64))).toBe(false);
    expect(await servesWebAsset(await account('nobody'), urlHash(shown))).toBe(false);
  });
});

describe('the canonical address of an artifactbin copy', () => {
  it('is on the verified domain for the owner\'s public document: the root, then a mapped path, then the post path', async () => {
    const w = await world();
    expect(await canonicalDocumentUrl(w.post)).toBe(`https://${HOST}/${w.post.id}-hello-world`);
    await setDomainPath(w.owner, '/zeta', w.post.id);
    await setDomainPath(w.owner, '/alpha', w.post.id);
    expect(await canonicalDocumentUrl(w.post)).toBe(`https://${HOST}/alpha`);
    await setDomainHomepage(w.owner, w.post.id);
    expect(await canonicalDocumentUrl(w.post)).toBe(`https://${HOST}/`);
    expect(await canonicalDocumentUrl(w.second)).toBe(`https://${HOST}/${w.second.id}-second-post`);
  });

  it('is the app address for an unlisted or private document, another owner\'s, a pending domain, and once removed', async () => {
    const w = await world();
    expect(await canonicalDocumentUrl(w.quiet)).toBe(`${APP}/@vivek/${w.quiet.id}-unlisted-draft`);
    expect(await canonicalDocumentUrl(w.secret)).toBe(`${APP}/@vivek/${w.secret.id}-private-plan`);
    expect(await canonicalDocumentUrl(w.theirs)).toBe(`${APP}/@stranger/${w.theirs.id}-stranger-post`);
    await removeDomain(w.owner);
    expect(await canonicalDocumentUrl(w.post)).toBe(`${APP}/@vivek/${w.post.id}-hello-world`);
    await attach(w.owner, HOST, false);
    expect(await canonicalDocumentUrl(w.post)).toBe(`${APP}/@vivek/${w.post.id}-hello-world`);
  });

  it('uses the one canonical origin without doubling its slash', async () => {
    const w = await world();
    overrideConfig({ publicBaseUrl: `${APP}/` });
    expect(await canonicalDocumentUrl(w.theirs)).toBe(`${APP}/@stranger/${w.theirs.id}-stranger-post`);
  });
});
