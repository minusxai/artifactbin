import {createHistoricalPage} from './historical-page';
/**
 * Live region sessions through their HTTP doors (contract @artifactbin/contracts region-sessions): who may open, send
 * and stream (editors only, the uniform 404 for everyone else), the open's row and snapshot, validated updates relayed
 * to other editors' streams, retries and recovery, resets, saving as page versions, an author's whole-page PUT merged
 * with editors' unsaved typing, and regions closed by a PUT or a revert. (Erasure: lib/operations region-erase.test.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '@/lib/html-page';
import { createTestUser, createUser, identityForUser } from '@/lib/accounts';
import { artifactState, createArtifact, getArtifactById, revertArtifactFor } from '@/lib/artifacts';
import { editableRegions, normalizeRegionHtml, openRegionDoc, regionHtml, regionText } from '@/lib/live-regions';
import { runWithRequest } from '@/lib/platform';
import { BROWSER_SESSION_HEADER, type Actor } from '@artifactbin/contracts';
import { attachActor } from '@artifactbin/utils';
import { POST as openRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/open/route';
import { POST as updatesRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/updates/route';
import { POST as flushRoute } from '@/app/api/artifacts/[id]/regions/flush/route';
import { GET as documentStreamRoute } from '@/app/a/[id]/events/route';
import { GET as streamRoute } from '@/app/api/artifacts/[id]/regions/stream/route';
import { PUT as putRoute } from '@/app/api/artifacts/[id]/route';
import { regionSessions } from '@/app/api/artifacts/[id]/regions/doors';
import { nativeHtml } from './native-html-fixture';
import { mintAccountToken, request, useAppHarness, type RequestOptions } from './harness';
import { sseStream } from './sse';

const harness = useAppHarness();
const nativeText=(doc:Y.Doc)=>(doc.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText;

const BODY = '<article data-af-editable="rich-native-v1"><p>Hello world</p><h2>Plan</h2><p>Second paragraph</p></article><section data-af-id="plain" data-af-editable="rich-native-v1"><p>Title</p></section><p>Outside</p>';
type Person = { id: string; email: string };
let owner: Person, editor: Person, viewer: Person, commenter: Person, stranger: Person;
let pageId: string, rich: string, plain: string;

const as = (person: Person): Actor => ({ credential: 'session', userId: person.id, email: person.email, emailVerified: true });
const call = <T>(req: Request, run: () => Promise<T>) => runWithRequest(req, run);
const sessionOpts = (person: Person | null, extra: RequestOptions = {}): RequestOptions => ({ origin: 'same', ...(person ? { actor: as(person) } : {}), ...extra });

async function open(person: Person | null, id = pageId, regionId = rich, extra: RequestOptions = {}) {
  const req = request(`/api/artifacts/${id}/regions/${regionId}/open`, { method: 'POST', ...sessionOpts(person, extra) });
  return call(req, () => openRoute(req, { params: Promise.resolve({ id, regionId }) }));
}
async function send(person: Person | null, body: unknown, id = pageId, regionId = rich, extra: RequestOptions = {}) {
  const req = request(`/api/artifacts/${id}/regions/${regionId}/updates`, { method: 'POST', json: body, ...sessionOpts(person, extra) });
  return call(req, () => updatesRoute(req, { params: Promise.resolve({ id, regionId }) }));
}
async function flush(person: Person | null, id = pageId, extra: RequestOptions = {}) {
  const req = request(`/api/artifacts/${id}/regions/flush`, { method: 'POST', ...sessionOpts(person, extra) });
  return call(req, () => flushRoute(req, { params: Promise.resolve({ id }) }));
}
const streams: { abort: AbortController; close(): void }[] = [];
async function stream(person: Person | null, after: string, id = pageId, extra: RequestOptions = {}) {
  const abort = new AbortController();
  const unsigned = request(`/api/artifacts/${id}/regions/stream?after=${encodeURIComponent(after)}`, { ...sessionOpts(null, extra), origin: undefined });
  // The attached actor is keyed by the Request object, so it is attached to the one carrying the signal.
  const signalled = new Request(unsigned, { signal: abort.signal });
  const actor = person ? as(person) : extra.actor;
  const req = actor ? attachActor(signalled, actor) : signalled;
  const response = await call(req, () => streamRoute(req, { params: Promise.resolve({ id }) }));
  if (response.status !== 200) return { response, frames: null };
  const reader = sseStream(response.body!);
  const handle = { abort, close: () => { abort.abort(); reader.close(); } };
  streams.push(handle);
  return { response, frames: reader, close: handle.close };
}
async function put(body: string, expectedVersion?: number) {
  const token = await mintAccountToken('regions-put', owner.id);
  const row = (await getArtifactById(pageId))!;
  const req = request(`/api/artifacts/${pageId}`, { method: 'PUT', token: token.token, json: { html: nativeHtml(body), expectedVersion: expectedVersion ?? row.version, expectedState: artifactState(row) } });
  return call(req, () => putRoute(req, { params: Promise.resolve({ id: pageId }) }));
}

/** An editor's replica: the server's bytes, writing under the client id its open was given. */
async function join(person: Person | null, regionId = rich, extra: RequestOptions = {}, id = pageId) {
  const response = await open(person, id, regionId, extra);
  expect(response.status).toBe(200);
  const reply = await response.json() as { clientId: number; seq: number; state: string; kind: string; savedVersion: number };
  const doc = openRegionDoc(Buffer.from(reply.state, 'base64'), { kind:reply.kind as 'rich-native-v1',clientId: reply.clientId });
  const pending: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'server') pending.push(update); });
  return {
    reply, doc, text: reply.kind==='rich-native-v1'?nativeText(doc):regionText(doc), pending,
    /** Sends everything typed since the last push, merged, and answers the reply. */
    async push() {
      const update = Y.mergeUpdates(pending.splice(0));
      const response = await send(person, { clientId: reply.clientId, update: Buffer.from(update).toString('base64') }, id, regionId, extra);
      return { status: response.status, body: await response.json() as Record<string, unknown>, update };
    },
    receive(updates: string[]) { for (const update of updates) Y.applyUpdate(doc, Buffer.from(update, 'base64'), 'server'); },
    html: () => regionHtml(reply.kind as 'rich-native-v1', Y.encodeStateAsUpdate(doc)),
  };
}

/** Frames until one satisfies `done` (or the budget ends). */
async function framesUntil(frames: ReturnType<typeof sseStream>, done: (frame: Record<string, unknown>) => boolean, budgetMs = 3000) {
  const seen: Record<string, unknown>[] = [];
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const [event] = await frames.next(1, deadline - Date.now());
    if (!event) break;
    if (event.event !== 'message') continue;
    seen.push(event.data);
    if (done(event.data)) return seen;
  }
  throw new Error(`no matching frame in ${JSON.stringify(seen).slice(0, 2000)}`);
}

const db = () => harness.db();
const rows = async (table: string, id = pageId) => (await (await db()).query(`SELECT * FROM ${table} WHERE artifact_id = $1`, [id])).rows;
const savedRegion = async (regionId = rich) => editableRegions((await getArtifactById(pageId))!.source!).find((region) => region.id === regionId)!;

beforeEach(async () => {
  const person = async (name: string) => { const user = await createUser({ email: `mxmx_test_regions_${name}@example.com` }); return { id: user.id, email: user.email! }; };
  [owner, editor, viewer, commenter, stranger] = await Promise.all(['owner', 'editor', 'viewer', 'commenter', 'stranger'].map(person));
  const row = await createArtifact(null, owner.id, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'private' });
  pageId = row.id;
  const regions = editableRegions(row.source!);
  rich = regions.find((region) => region.kind === 'rich-native-v1')!.id;
  plain = regions.find((region) => region.id === 'plain')!.id;
  const q = await db();
  for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer'], [commenter, 'commenter']] as const) await q.query('INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, $3)', [pageId, who.email, role]);
});
afterEach(async () => {
  for (const handle of streams.splice(0)) handle.close();
  regionSessions().dispose();
});

describe('who may edit live', () => {
  it('owner and editor open; viewers, commenters, link holders, other users, the signed-out and bearer tokens get the unknown id\'s 404', async () => {
    const unknown = await open(owner, 'zzzzzz', rich);
    expect(unknown.status).toBe(404);
    const uniform = await unknown.text();
    const unlisted = await createArtifact(null, owner.id, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'unlisted' });
    const unlistedRegion = editableRegions(unlisted.source!).find((region) => region.kind === 'rich-native-v1')!.id;
    const token = await mintAccountToken('regions-agent', owner.id);
    const refused: [string, () => Promise<Response>][] = [
      ['viewer', () => open(viewer)], ['commenter', () => open(commenter)], ['stranger', () => open(stranger)], ['signed out', () => open(null)],
      ['link holder', () => open(stranger, unlisted.id, unlistedRegion)],
      ['owner bearer', () => open(null, pageId, rich, { token: token.token })],
      ['viewer update', () => send(viewer, { clientId: 1, update: 'AAA=' })],
      ['stranger update', () => send(stranger, { clientId: 1, update: 'AAA=' })],
      ['bearer update', () => send(null, { clientId: 1, update: 'AAA=' }, pageId, rich, { token: token.token })],
      ['viewer flush', () => flush(viewer)], ['commenter flush', () => flush(commenter)], ['signed-out flush', () => flush(null)],
    ];
    for (const [name, attempt] of refused) {
      const response = await attempt();
      expect([name, response.status]).toEqual([name, 404]);
      expect([name, await response.text()]).toEqual([name, uniform]);
    }
    for (const [name, person, extra] of [['viewer', viewer, {}], ['signed out', null, {}], ['bearer', null, { token: token.token }]] as const) {
      const { response } = await stream(person, `${rich}:0`, pageId, extra);
      expect([name, response.status, await response.text()]).toEqual([name, 404, uniform]);
    }
    expect((await open(owner)).status).toBe(200);
    expect((await open(editor)).status).toBe(200);
    expect((await flush(null, pageId, { token: token.token })).status).toBe(200);
    expect((await open(editor, pageId, rich, { origin: 'https://elsewhere.example' })).status).toBe(403);
  });

  it('a region the page does not declare is region_not_found; one whose saved content the kind cannot hold is unsupported_content', async () => {
    const missing = await open(owner, pageId, 'nosuchregion');
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'region_not_found' }]);
    const svg = await createHistoricalPage(null, owner.id, { format: 'html', source: nativeHtml('<section data-af-editable="rich-native-v1"><p>a</p><svg></svg></section>'), meta: {}, visibility: 'private' });
    const region = editableRegions(svg.source!)[0]!.id;
    const refused = await open(owner, svg.id, region);
    expect([refused.status, (await refused.json()).error]).toEqual([422, 'unsupported_content']);
  });
});

/** A browser session's scripted browser (check.mjs, `viewer:{testuser}`): the transport attaches its bearer and marks it, sending no Authorization. */
const scripted = (userId: string, tokenId: string): RequestOptions => ({ origin: undefined, actor: { credential: 'bearer', userId, tokenId }, headers: { [BROWSER_SESSION_HEADER]: '1' } });

describe('a browser session\'s scripted browser', () => {
  it('opens, types and streams like the person it browses as; a plain bearer call, the mark alone and the signed-out stay refused', async () => {
    const token = await mintAccountToken('regions-browser', owner.id);
    const browser = scripted(owner.id, token.id);
    const typing = await join(null, rich, browser);
    typing.text.insert(0, 'Typed by a scripted browser ', {});
    expect((await typing.push()).status).toBe(200);
    const { response } = await stream(null, `${rich}:${typing.reply.seq}`, pageId, browser);
    expect(response.status).toBe(200);
    expect((await flush(null, pageId, browser)).status).toBe(200);
    expect((await getArtifactById(pageId))!.source).toContain('Typed by a scripted browser');
    const bearer: Actor = { credential: 'bearer', userId: owner.id, tokenId: token.id };
    const refused: [string, RequestOptions][] = [
      ['a bearer the proxy resolved (Authorization present)', { actor: bearer, headers: { authorization: `Bearer ${token.token}` } }],
      ['a marked bearer still carrying Authorization', { actor: bearer, headers: { authorization: `Bearer ${token.token}`, [BROWSER_SESSION_HEADER]: '1' } }],
      ['an explicit bearer', { token: token.token, headers: { [BROWSER_SESSION_HEADER]: '1' } }],
      ['a bearer with no mark', { actor: bearer }],
      ['the mark with no actor', { headers: { [BROWSER_SESSION_HEADER]: '1' } }],
      ['a revoked token', scripted(owner.id, 'tok_gone')],
    ];
    for (const [name, extra] of refused) {
      expect([name, (await open(null, pageId, rich, extra)).status]).toEqual([name, 404]);
      expect([name, (await send(null, { clientId: typing.reply.clientId, update: 'AAA=' }, pageId, rich, extra)).status]).toEqual([name, 404]);
    }
  });

  it('as a test user, edits a page inside its own sandbox and is refused on its parent\'s', async () => {
    const parent = await mintAccountToken('regions-parent', owner.id);
    const minted = await createTestUser(identityForUser(owner.id, parent.id));
    if (!minted.ok) throw new Error(minted.error);
    const sandbox = await createArtifact(minted.tokenId, minted.userId, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'unlisted' });
    const sandboxRich = editableRegions(sandbox.source!).find((region) => region.kind === 'rich-native-v1')!.id;
    const browser = scripted(minted.userId, minted.tokenId);
    expect((await open(null, sandbox.id, sandboxRich, browser)).status).toBe(200);
    expect((await open(null, pageId, rich, browser)).status).toBe(404);
    const unlisted = await createArtifact(null, owner.id, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'unlisted' });
    expect((await open(null, unlisted.id, editableRegions(unlisted.source!).find((region) => region.kind === 'rich-native-v1')!.id, browser)).status).toBe(404);
  });
});

describe('opening a region', () => {
  it('creates its row and the saved version\'s snapshot once, however many open at once, each with its own client id', async () => {
    const replies = await Promise.all([owner, editor, owner, editor].map(async (person) => (await open(person)).json() as Promise<{ clientId: number; seq: number; savedVersion: number; state: string }>));
    expect((await rows('region_states')).length).toBe(1);
    expect((await rows('region_snapshots')).map((row) => row.version)).toEqual([1]);
    expect(new Set(replies.map((reply) => reply.clientId)).size).toBe(4);
    expect(replies.map((reply) => reply.seq).sort()).toEqual([1, 2, 3, 4]);
    expect(replies.every((reply) => reply.savedVersion === 1)).toBe(true);
    const doc = openRegionDoc(Buffer.from(replies[0]!.state, 'base64'), { gc: true,kind:'rich-native-v1' });
    expect(regionHtml('rich-native-v1', Y.encodeStateAsUpdate(doc))).toBe(regionHtml('rich-native-v1', Buffer.from(replies[3]!.state, 'base64')));
    expect(nativeText(doc).toString()).toContain('Hello world');
  });
});

describe('updates', () => {
  it('reach a second editor\'s stream, in order; a retry is a duplicate; another session\'s client id is foreign', async () => {
    const a = await join(owner), b = await join(editor);
    const { frames } = await stream(editor, `${rich}:${b.reply.seq}`);
    a.text.insert(0, 'Owner says ', {});
    const first = await a.push();
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ seq: b.reply.seq + 1 });
    const seen = await framesUntil(frames!, (frame) => frame.type === 'updates' && frame.to === first.body.seq);
    for (const frame of seen) if (frame.type === 'updates') b.receive(frame.updates as string[]);
    expect(b.text.toString()).toContain('Owner says Hello world');
    const retry = await send(owner, { clientId: a.reply.clientId, update: Buffer.from(first.update).toString('base64') });
    expect(await retry.json()).toEqual({ seq: first.body.seq, duplicate: true });
    // Structs written under the owner's client id (or one no open issued), by the editor: refused, never stored.
    const forge = (clientId: number) => {
      const doc = openRegionDoc(Y.encodeStateAsUpdate(b.doc));
      doc.clientID = clientId;
      const before = Y.encodeStateVector(doc);
      regionText(doc).insert(0, 'forged ', {});
      return Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString('base64');
    };
    const stolen = await send(editor, { clientId: a.reply.clientId, update: forge(a.reply.clientId) });
    expect([stolen.status, await stolen.json()]).toEqual([422, { error: 'foreign_client' }]);
    const forged = await send(editor, { clientId: 12345, update: forge(12345) });
    expect([forged.status, await forged.json()]).toEqual([422, { error: 'foreign_client' }]);
    b.text.insert(0, 'x', {});
    const mismatched = await send(editor, { clientId: a.reply.clientId, update: Buffer.from(Y.mergeUpdates(b.pending)).toString('base64') });
    expect([mismatched.status, await mismatched.json()]).toEqual([422, { error: 'foreign_client' }]);
    expect((await b.push()).status).toBe(200);
    expect((await rows('region_updates')).some((row) => regionText(openRegionDoc(row.update as Uint8Array, { gc: true })).toString().includes('forged'))).toBe(false);
  });

  it('refuses out_of_order with the server\'s state vector, and the client recovers by resending from it', async () => {
    const a = await join(owner);
    a.text.insert(0, 'A', {});
    const firstUpdate = a.pending.splice(0);
    a.text.insert(1, 'B', {});
    const gap = await a.push();
    expect(gap.status).toBe(409);
    expect(gap.body.error).toBe('out_of_order');
    const resend = Y.encodeStateAsUpdate(a.doc, Buffer.from(gap.body.stateVector as string, 'base64'));
    const recovered = await send(owner, { clientId: a.reply.clientId, update: Buffer.from(resend).toString('base64') });
    expect(recovered.status).toBe(200);
    expect(firstUpdate.length).toBe(1);
    const { frames } = await stream(owner, `${rich}:${a.reply.seq}`);
    const seen = await framesUntil(frames!, (frame) => frame.type === 'updates');
    const replica = await join(editor);
    replica.receive((seen[0]!.updates as string[]));
    expect(replica.text.toString().startsWith('AB')).toBe(true);
  });

  it('refuses unsupported content and too-large bodies by name, storing nothing', async () => {
    const a = await join(owner);
    a.text.format(0, 3, { level: 2 });
    const refused = await a.push();
    expect([refused.status, refused.body.error]).toEqual([422, 'unsupported_content']);
    const big = await send(owner, { clientId: a.reply.clientId, update: 'A'.repeat(400_000) });
    expect(big.status).toBe(413);
    expect((await rows('region_updates')).length).toBe(1);
  });
});

describe('the stream', () => {
  it('resets a cursor that predates the folded state or runs ahead of the log, then streams on', async () => {
    const a = await join(owner);
    a.text.insert(0, 'saved ', {});
    await a.push();
    expect((await flush(owner)).status).toBe(200);
    const [row] = await rows('region_states');
    expect(Number(row!.state_seq)).toBeGreaterThan(0);
    const stale = await stream(editor, `${rich}:0`);
    const [reset] = await framesUntil(stale.frames!, (frame) => frame.type === 'reset');
    expect(reset).toMatchObject({ type: 'reset', regionId: rich, seq: Number(row!.last_seq) });
    const doc = openRegionDoc(Buffer.from(reset!.state as string, 'base64'), { gc: true,kind:'rich-native-v1' });
    expect(nativeText(doc).toString()).toContain('saved Hello');
    const ahead = await stream(editor, `${rich}:999`);
    expect((await framesUntil(ahead.frames!, (frame) => frame.type === 'reset'))[0]).toMatchObject({ seq: Number(row!.last_seq) });
    a.text.insert(0, 'more ', {});
    const next = await a.push();
    expect((await framesUntil(stale.frames!, (frame) => frame.type === 'updates'))[0]).toMatchObject({ from: next.body.seq, to: next.body.seq });
  });

  it('closes every region with reason access when the editor loses edit access, and ends', async () => {
    const b = await join(editor);
    const { frames } = await stream(editor, `${rich}:${b.reply.seq}`);
    await (await db()).query('DELETE FROM artifact_shares WHERE artifact_id = $1 AND email = $2', [pageId, editor.email]);
    await (await db()).query("SELECT pg_notify($1, '')", [`artifact_${pageId.toLowerCase()}`]);
    expect((await framesUntil(frames!, (frame) => frame.type === 'closed'))[0]).toEqual({ type: 'closed', regionId: rich, reason: 'access' });
  });

  it('opens with a heartbeat frame, so a finite window (a browser session\'s scripted browser) always carries one', async () => {
    const { reply } = await join(owner);
    const { frames } = await stream(owner, `${rich}:${reply.seq}`);
    const [first] = await frames!.next(1, 2000);
    expect(first?.event).toBe('keepalive');
  });

  it('refuses a malformed cursor', async () => {
    expect((await stream(owner, 'no-seq')).response.status).toBe(400);
  });
});

describe('saving as page versions', () => {
  it('flush saves every region\'s unsaved edits as one version whose source holds the merged text in canonical form; nothing unsaved changes nothing', async () => {
    const a = await join(owner), b = await join(editor), t = await join(owner, plain);
    const { frames } = await stream(editor, `${rich}:${b.reply.seq + 0}`);
    a.text.insert(0, 'From owner. ', {});
    b.text.insert(b.text.length, ' And editor', { bold: {} });
    t.text.insert(t.text.length, ' renamed', {});
    expect((await a.push()).status).toBe(200); expect((await b.push()).status).toBe(200); expect((await t.push()).status).toBe(200);
    const flushed = await flush(editor);
    expect(await flushed.json()).toEqual({ version: 2 });
    const head = (await getArtifactById(pageId))!;
    expect(head.version).toBe(2);
    expect(canonicalizeHtmlPage(head.source!).html).toBe(head.source);
    expect(head.source).toContain('Outside');
    const seen = await framesUntil(frames!, (frame) => frame.type === 'saved');
    for (const frame of seen) if (frame.type === 'updates') b.receive(frame.updates as string[]);
    expect(seen.at(-1)).toMatchObject({ type: 'saved', version: 2 });
    // Inline ids are canonicalizeHtmlPage's (the comments track stops assigning them inside regions); blocks match exactly.
    expect(normalizeRegionHtml('rich-native-v1', (await savedRegion()).inner)).toBe(b.html());
    expect((await savedRegion()).inner).toContain('From owner. Hello world');
    expect((await savedRegion()).inner).toMatch(/<strong[^>]*> And editor<\/strong>/);
    expect((await savedRegion(plain)).inner).toMatch(/>Title renamed<\/p>/);
    const snapshots = await rows('region_snapshots');
    expect(snapshots.filter((row) => row.version === 2).map((row) => row.region_id).sort()).toEqual([plain, rich].sort());
    expect(await (await flush(owner)).json()).toEqual({ version: 2 });
  });
});

describe('a whole-page PUT while editors type', () => {
  it('keeps the editor\'s unsaved typing and the author\'s change; the editor converges to the stored region', async () => {
    const b = await join(editor);
    const { frames } = await stream(editor, `${rich}:${b.reply.seq}`);
    b.text.insert(b.text.toString().indexOf('world') + 5, ' UNSAVED', {});
    expect((await b.push()).status).toBe(200);
    const saved = (await getArtifactById(pageId))!.source!;
    const response = await put(saved.replace('Second paragraph', 'Second paragraph, revised by the author'));
    expect(response.status).toBe(200);
    const stored = await savedRegion();
    expect(stored.inner).toContain('Hello world UNSAVED');
    expect(stored.inner).toContain('revised by the author');
    const seen = await framesUntil(frames!, (frame) => frame.type === 'saved');
    for (const frame of seen) if (frame.type === 'updates') b.receive(frame.updates as string[]);
    expect(b.html()).toBe(normalizeRegionHtml('rich-native-v1', stored.inner));
    const [row] = await rows('region_states');
    expect([row!.dirty_since, row!.saved_version]).toEqual([null, 2]);
  });

  it('closes a region the PUT removes (removed) or re-declares as another kind (kind_changed), deleting its rows', async () => {
    await (await db()).query("UPDATE artifacts SET source=replace(source,'data-af-id=\"plain\" data-af-editable=\"rich-native-v1\"','data-af-id=\"plain\" data-af-editable=\"rich\"') WHERE id=$1",[pageId]);
    const a = await join(owner), t = await join(owner, plain);
    const { frames } = await stream(owner, `${rich}:${a.reply.seq},${plain}:${t.reply.seq}`);
    const saved = (await getArtifactById(pageId))!.source!;
    const withoutRich = saved.replace(/<article[\s\S]*<\/article>/, '').replace('data-af-editable="rich"', 'data-af-editable="rich-native-v1"');
    expect((await put(withoutRich)).status).toBe(200);
    const closed = (await framesUntil(frames!, (frame) => frame.type === 'closed' && frame.regionId === plain)).filter((frame) => frame.type === 'closed');
    const reasons = Object.fromEntries((closed.length < 2 ? [...closed, ...(await framesUntil(frames!, (frame) => frame.type === 'closed'))] : closed).map((frame) => [frame.regionId, frame.reason]));
    expect(reasons).toEqual({ [rich]: 'removed', [plain]: 'kind_changed' });
    expect(await rows('region_states')).toEqual([]);
    expect(await rows('region_updates')).toEqual([]);
    expect(await rows('region_snapshots')).toEqual([]);
  });

  it('a region left clean by a save carries its snapshot to the new version, so the next PUT merges instead of refusing', async () => {
    const a = await join(owner);
    await join(owner, plain);
    a.text.insert(0, 'Only rich. ', {});
    await a.push();
    expect(await (await flush(owner)).json()).toEqual({ version: 2 });
    const snapshots = (await rows('region_snapshots')).filter((row) => row.version === 2).map((row) => row.region_id).sort();
    expect(snapshots).toEqual([plain, rich].sort());
    const saved = (await getArtifactById(pageId))!.source!;
    const response = await put(saved.replace('Outside', 'Outside, edited'));
    expect(response.status).toBe(200);
    expect((await savedRegion(plain)).inner).toMatch(/>Title<\/p>/);
  });

  it('a PUT from a stale version is the existing version conflict, and changes no region row', async () => {
    const a = await join(owner);
    a.text.insert(0, 'x', {});
    await a.push();
    const before = await rows('region_states');
    expect((await put((await getArtifactById(pageId))!.source!, 7)).status).toBe(409);
    expect(await rows('region_states')).toEqual(before);
  });
});

describe('whole-page writes that leave nothing to merge into', () => {
  it('a revert saves the unsaved typing as its own version first, then closes the regions', async () => {
    const a = await join(owner);
    a.text.insert(0, 'saved ', {});
    await a.push();
    expect(await (await flush(owner)).json()).toEqual({ version: 2 });
    a.text.insert(0, 'typed ', {});
    await a.push();
    const reverted = await revertArtifactFor(identityForUser(owner.id, null), pageId, 1);
    expect(reverted && 'version' in reverted ? reverted.version : reverted).toBe(4);
    const q = await db();
    const archived = (await q.query<{ source: string }>('SELECT source FROM artifact_versions WHERE artifact_id = $1 AND version = 3', [pageId])).rows[0]!;
    expect(archived.source).toContain('typed saved Hello world');
    expect((await getArtifactById(pageId))!.source).not.toContain('typed');
    expect(await rows('region_states')).toEqual([]);
  });
});

async function multiplex(person: Person | null, after: string, anonymous=false, extra:RequestOptions={}) {
  const abort=new AbortController();
  const base=request(`/a/${pageId}/events?regions=${encodeURIComponent(after)}${anonymous?'&anonymous=1':''}`,sessionOpts(null,extra));
  const signalled=new Request(base,{signal:abort.signal});
  const req=person?attachActor(signalled,as(person)):signalled;
  const response=await call(req,()=>documentStreamRoute(req,{params:Promise.resolve({id:pageId})}));
  if(response.status!==200)return {response,frames:null};
  const frames=sseStream(response.body!);streams.push({abort,close(){abort.abort();frames.close();}});
  return {response,frames};
}
it('document multiplex refuses readable viewers and anonymous region subscribers',async()=>{
  for(const person of [viewer,commenter,null]) {
    const opened=await multiplex(person,`${rich}:0`);
    expect(opened.response.status).toBe(404);
  }
  expect((await multiplex(owner,`${rich}:0`,true)).response.status).toBe(404);
});
it('document multiplex delivers ordinary pings and authorized region catchup, then revokes region access',async()=>{
  const writer=await join(owner);
  writer.text.insert(0,'Before stream ');expect((await writer.push()).status).toBe(200);
  const opened=await multiplex(editor,`${rich}:0`);expect(opened.response.status).toBe(200);
  const caught=(await opened.frames!.named('regions',1,1000))[0]?.data;
  expect(caught).toMatchObject({type:'updates',regionId:rich,from:1});
  const follower=openRegionDoc(Buffer.from(writer.reply.state,'base64'),{kind:'rich-native-v1'});
  for(const update of caught!.updates as string[])Y.applyUpdate(follower,Buffer.from(update,'base64'));
  expect(nativeText(follower).toString()).toContain('Before stream ');follower.destroy();
  expect((await opened.frames!.named('message',1,1000))[0]?.data).toHaveProperty('version');
  // Current ACL, not the original admission, controls every catch-up.
  await (await harness.db()).query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND email=$2',[pageId,editor.email]);
  writer.text.insert(0,'After revoke ');expect((await writer.push()).status).toBe(200);
  expect((await opened.frames!.named('regions',1,1000))[0]?.data).toMatchObject({type:'closed',regionId:rich,reason:'access'});
});

it('document multiplex retains the browser-only, same-origin and bounded region doors',async()=>{
 const token=await mintAccountToken('multiplex-agent',owner.id);
 expect((await multiplex(null,`${rich}:0`,false,{token:token.token})).response.status).toBe(404);
 expect((await multiplex(owner,`${rich}:0`,false,{origin:'https://elsewhere.example'})).response.status).toBe(403);
 expect((await multiplex(owner,Array.from({length:65},(_,i)=>`af-${i}:0`).join(','))).response.status).toBe(400);
 expect((await multiplex(owner,`${rich}:0,${rich}:0`)).response.status).toBe(400);
});
