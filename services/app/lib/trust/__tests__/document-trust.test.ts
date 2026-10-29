import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { ANONYMOUS_ACTOR, identityForUser, type AccessActor } from '@/lib/accounts';
import { artifactState, getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import {
  allowDocument, carriedTrust, cspExtensionsFor, cspRequestFor, declaredCspExtensions, denyDocument, extensionsHash, hostsPublishedBy,
  revokeTrust, sessionTrustCookie,
} from '..';

useAppHarness();
const METEO = 'https://api.open-meteo.com', PLOTLY = 'https://cdn.plot.ly';
const NONE = { connect: [], script: [], style: [], img: [], frame: [], media: [] };
const set = (connect: string[], script: string[] = []) => ({ ...NONE, connect, script });
const page = (connect: string, script = '') => `<!doctype html><html><head><meta name="csp-connect" content="${connect}">${script ? `<meta name="csp-script" content="${script}">` : ''}</head><body><p>x</p></body></html>`;
/** The cookie a browser sends back after `set-cookie`. */
const sent = (setCookie: string) => request('/doc', { cookie: setCookie.split(';')[0]! });

async function author(name: string) {
  const token = await mintAccountToken(name);
  return { token, actor: identityForUser(token.userId!, token.id) as AccessActor };
}
async function publish(token: string, html: string): Promise<string> {
  const made = await create(request('/api/artifacts', { method: 'POST', token, json: { html, visibility: 'public' } }));
  expect(made.status).toBe(201);
  return (await made.json() as { id: string }).id;
}
async function republish(token: string, id: string, html: string) {
  const row = (await getArtifactById(id))!;
  const saved = await replace(request(`/api/artifacts/${id}`, { method: 'PUT', token, json: { html, expectedVersion: row.version, expectedState: artifactState(row) } }), { params: Promise.resolve({ id }) });
  expect(saved.status).toBe(200);
}
const served = async (id: string) => { const row = (await getArtifactById(id))!; return { id, version: row.version, source: row.source }; };

describe('declaredCspExtensions', () => {
  it('reads the csp metas of the head, canonicalizing origins, and declares nothing without them', () => {
    expect(declaredCspExtensions(page('https://API.open-meteo.com/', PLOTLY))).toEqual(set([METEO], [PLOTLY]));
    for (const source of [null, undefined, '', '<p>no metas</p>']) expect(declaredCspExtensions(source)).toEqual(NONE);
  });

  it('drops origins the parser refuses instead of trusting them', () => {
    expect(declaredCspExtensions(page('http://insecure.example.com https://user:pw@x.example.com')).connect).toEqual([]);
  });
});

describe('extensionsHash', () => {
  it('identifies a set independent of order, and distinguishes directives and members', () => {
    const hash = extensionsHash(set(['https://a.example.com', 'https://b.example.com']));
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(extensionsHash(set(['https://b.example.com', 'https://a.example.com']))).toBe(hash);
    expect(extensionsHash(set([], ['https://a.example.com', 'https://b.example.com']))).not.toBe(hash);
    expect(extensionsHash(set(['https://a.example.com']))).not.toBe(hash);
  });
});

describe('hostsPublishedBy', () => {
  it('answers the hosts this viewer introduced, by the earliest version of the unbroken run that declares them', async () => {
    const owner = await author('trust-owner'), other = await author('trust-other');
    const id = await publish(owner.token.token, page(METEO));
    await republish(owner.token.token, id, page(METEO, PLOTLY));
    const head = await served(id), declared = declaredCspExtensions(head.source);
    expect(await hostsPublishedBy(head, owner.actor, declared)).toEqual(set([METEO], [PLOTLY]));
    expect(await hostsPublishedBy(head, other.actor, declared)).toEqual(NONE);
    expect(await hostsPublishedBy(head, null, declared)).toEqual(NONE);
    expect(await hostsPublishedBy(head, ANONYMOUS_ACTOR, declared)).toEqual(NONE);
    // Attribute version 1 to someone else: METEO arrived there, PLOTLY in the owner's version 2.
    const db = await getDb();
    await db.query('UPDATE artifact_versions SET actor_user_id = $2, actor_token_id = NULL WHERE artifact_id = $1 AND version = 1', [id, other.actor.userId]);
    expect(await hostsPublishedBy(head, owner.actor, declared)).toEqual(set([], [PLOTLY]));
    expect(await hostsPublishedBy(head, other.actor, declared)).toEqual(set([METEO]));
  });

  it('presumes nobody across a gap in the history, or for a version that is not the head', async () => {
    const owner = await author('trust-gap');
    const id = await publish(owner.token.token, page(METEO));
    await republish(owner.token.token, id, page(METEO).replace('<p>x</p>', '<p>second</p>'));
    await republish(owner.token.token, id, page(METEO, PLOTLY));
    const head = await served(id), declared = declaredCspExtensions(head.source);
    expect(head.version).toBe(3);
    expect(await hostsPublishedBy(head, owner.actor, declared)).toEqual(set([METEO], [PLOTLY]));
    expect(await hostsPublishedBy({ ...head, version: 99 }, owner.actor, declared)).toEqual(NONE);
    await (await getDb()).query('DELETE FROM artifact_versions WHERE artifact_id = $1 AND version = 2', [id]);
    // The missing version 2 might have introduced either host, so neither introducer is known.
    expect(await hostsPublishedBy(head, owner.actor, declared)).toEqual(NONE);
  });
});

describe('the session (once) cookie', () => {
  const doc = { id: 'doc_1', version: 1, declared: set([METEO]) };
  const viewer = identityForUser('usr_viewer', null);

  it('records an allow or deny for one document and the set asked about, and forgets it on request', async () => {
    const hash = extensionsHash(doc.declared);
    const allow = sessionTrustCookie(request('/doc'), viewer, doc.id, { hash, decision: 'allow' });
    expect(allow).toMatch(/HttpOnly/);
    expect(allow).toMatch(/SameSite=Lax/);
    expect(allow).not.toMatch(/Max-Age/);
    expect(await cspRequestFor({ artifact: doc, viewer, request: sent(allow) })).toMatchObject({ status: 'allowed', denied: false });
    const deny = sessionTrustCookie(sent(allow), viewer, doc.id, { hash, decision: 'deny' });
    expect(await cspRequestFor({ artifact: doc, viewer, request: sent(deny) })).toMatchObject({ status: 'blocked', denied: true, asking: set([METEO]) });
    const forgotten = sessionTrustCookie(sent(deny), viewer, doc.id, { decision: null });
    expect(forgotten).toMatch(/Max-Age=0/);
    expect(await cspRequestFor({ artifact: doc, viewer, request: sent(forgotten) })).toMatchObject({ status: 'blocked', denied: false });
  });

  it('fails closed on a tampered cookie, another subject’s cookie, or a grant for a different set', async () => {
    const hash = extensionsHash(doc.declared);
    const allow = sessionTrustCookie(request('/doc'), viewer, doc.id, { hash, decision: 'allow' });
    const [name, value] = allow.split(';')[0]!.split('=');
    const tampered = request('/doc', { cookie: `${name}=${value!.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))}` });
    expect((await cspRequestFor({ artifact: doc, viewer, request: tampered })).status).toBe('blocked');
    expect((await cspRequestFor({ artifact: doc, viewer: identityForUser('usr_other', null), request: sent(allow) })).status).toBe('blocked');
    expect((await cspRequestFor({ artifact: { ...doc, declared: set([METEO, 'https://more.example.com']) }, viewer, request: sent(allow) })).status).toBe('blocked');
    expect((await cspRequestFor({ artifact: doc, viewer, request: request('/doc', { cookie: `${name}=garbage` }) })).status).toBe('blocked');
  });

  it('keeps only the 24 most recent documents', async () => {
    let cookie = request('/doc');
    for (let i = 0; i < 25; i++) cookie = sent(sessionTrustCookie(cookie, viewer, `doc_${i}`, { hash: extensionsHash(doc.declared), decision: 'allow' }));
    expect((await cspRequestFor({ artifact: { ...doc, id: 'doc_0' }, viewer, request: cookie })).status).toBe('blocked');
    expect((await cspRequestFor({ artifact: { ...doc, id: 'doc_24' }, viewer, request: cookie })).status).toBe('allowed');
  });
});

describe('carriedTrust', () => {
  const doc = { id: 'doc_carried', version: 1, declared: set([METEO]) };
  it('hands the session’s grants to a document origin, answered there only for the same subject', async () => {
    const viewer = identityForUser('usr_carrier', null);
    const cookie = sessionTrustCookie(request('/doc'), viewer, doc.id, { hash: extensionsHash(doc.declared), decision: 'allow' });
    const carried = carriedTrust(sent(cookie), viewer);
    expect(Object.keys(carried)).toEqual(['trust']);
    expect((await cspRequestFor({ artifact: doc, viewer, carried })).status).toBe('allowed');
    expect((await cspRequestFor({ artifact: doc, viewer: identityForUser('usr_someone', null), carried })).status).toBe('blocked');
    expect((await cspRequestFor({ artifact: doc, viewer, carried: { trust: { s: 'u:usr_carrier', g: 'not-a-list' } } })).status).toBe('blocked');
    expect(carriedTrust(request('/doc'), viewer)).toEqual({});
  });
});

describe('standing rows: allowDocument, denyDocument, revokeTrust', () => {
  it('always-allow covers the set (merging later allows), never replaces it, revoke asks again', async () => {
    const reader = await author('trust-reader');
    const doc = { id: 'doc_rows', version: 1, declared: set([METEO], [PLOTLY]) };
    const status = async () => (await cspRequestFor({ artifact: doc, viewer: reader.actor })).status;
    await allowDocument(reader.actor.userId!, doc.id, set([METEO]));
    expect(await status()).toBe('blocked');
    await allowDocument(reader.actor.userId!, doc.id, set([], [PLOTLY]));
    expect(await status()).toBe('allowed');
    expect(await cspExtensionsFor({ artifact: doc, viewer: reader.actor })).toEqual(doc.declared);
    await denyDocument(reader.actor.userId!, doc.id, doc.declared);
    expect(await cspRequestFor({ artifact: doc, viewer: reader.actor })).toMatchObject({ status: 'blocked', denied: true });
    expect(await cspExtensionsFor({ artifact: doc, viewer: reader.actor })).toEqual(NONE);
    await revokeTrust(reader.actor.userId!, doc.id);
    expect(await cspRequestFor({ artifact: doc, viewer: reader.actor })).toMatchObject({ status: 'blocked', denied: false });
    await expect(revokeTrust(reader.actor.userId!, doc.id)).resolves.toBeUndefined();
  });

  it('never applies one document’s row to another document', async () => {
    const reader = await author('trust-scoped');
    await allowDocument(reader.actor.userId!, 'doc_a', set([METEO]));
    expect((await cspRequestFor({ artifact: { id: 'doc_b', version: 1, declared: set([METEO]) }, viewer: reader.actor })).status).toBe('blocked');
  });
});

describe('cspRequestFor and cspExtensionsFor', () => {
  it('ask nothing and append nothing for a document without declarations', async () => {
    const doc = { id: 'doc_plain', version: 1, source: '<p>x</p>' };
    expect(await cspRequestFor({ artifact: doc, viewer: null })).toEqual({ extensions: NONE, asking: NONE, status: 'none', denied: false });
    expect(await cspExtensionsFor({ artifact: doc, viewer: null })).toEqual(NONE);
  });

  it('give the publisher every host, and a stranger only the hosts they published (none)', async () => {
    const owner = await author('trust-publisher'), stranger = await author('trust-stranger');
    const id = await publish(owner.token.token, page(METEO));
    const head = await served(id);
    expect(await cspRequestFor({ artifact: head, viewer: owner.actor })).toMatchObject({ status: 'publisher', asking: NONE });
    expect(await cspExtensionsFor({ artifact: head, viewer: owner.actor })).toEqual(set([METEO]));
    expect(await cspRequestFor({ artifact: head, viewer: stranger.actor })).toMatchObject({ status: 'blocked', asking: set([METEO]) });
    expect(await cspExtensionsFor({ artifact: head, viewer: stranger.actor })).toEqual(NONE);
  });
});
