import {createArtifact} from '@/lib/artifacts';
import {createHistoricalPage} from './historical-page';
/**
 * Agents on live regions through their HTTP doors (operations read_region, write_region, save_regions; contract
 * region-sessions RegionContentReply/RegionWriteReply): reading a region as Markdown or HTML as the page reads now (an
 * editor's read saves unsaved typing first, so its version is an exact base), a
 * write merged with an editor's unsaved typing and streamed to them before the save, the `_doc` alias, idempotent
 * retries, and every refusal (access, stale base, unsupported content, a malformed write).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUser } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { editableRegions, openRegionDoc, regionHtml, regionText } from '@/lib/live-regions';
import { runWithRequest } from '@/lib/platform';
import type { Actor } from '@artifactbin/contracts';
import { attachActor } from '@artifactbin/utils';
import { POST as openRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/open/route';
import { POST as updatesRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/updates/route';
import { POST as flushRoute } from '@/app/api/artifacts/[id]/regions/flush/route';
import { GET as streamRoute } from '@/app/api/artifacts/[id]/regions/stream/route';
import { GET as readRoute, PUT as writeRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/route';
import { regionSessions } from '@/app/api/artifacts/[id]/regions/doors';
import { nativeHtml } from './native-html-fixture';
import { mintAccountToken, request, useAppHarness, type RequestOptions } from './harness';
import { sseStream } from './sse';

const harness = useAppHarness();

const BODY = '<h1 data-af-editable="text">Title</h1><article data-af-editable="rich"><p>Hello world</p><h2>Plan</h2><p>Second paragraph</p></article><p>Outside</p>';
type Person = { id: string; email: string };
let owner: Person, editor: Person, viewer: Person, stranger: Person;
let pageId: string, rich: string, plain: string, agent: string, viewerToken: string;

const as = (person: Person): Actor => ({ credential: 'session', userId: person.id, email: person.email, emailVerified: true });
const call = <T>(req: Request, run: () => Promise<T>) => runWithRequest(req, run);
type Who = { person: Person } | { token: string } | null;
const credentials = (who: Who): RequestOptions => (who === null ? {} : 'token' in who ? { token: who.token } : { actor: as(who.person), origin: 'same' });

async function read(who: Who, regionId = '_doc', query = '', id = pageId) {
  const req = request(`/api/artifacts/${id}/regions/${regionId}${query}`, credentials(who));
  const response = await call(req, () => readRoute(req, { params: Promise.resolve({ id, regionId }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function write(who: Who, body: unknown, regionId = '_doc', headers: Record<string, string> = {}, id = pageId) {
  const req = request(`/api/artifacts/${id}/regions/${regionId}`, { method: 'PUT', json: body, headers, ...credentials(who) });
  const response = await call(req, () => writeRoute(req, { params: Promise.resolve({ id, regionId }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function flush(who: Who) {
  const req = request(`/api/artifacts/${pageId}/regions/flush`, { method: 'POST', ...credentials(who) });
  const response = await call(req, () => flushRoute(req, { params: Promise.resolve({ id: pageId }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** An editor's replica in the browser: the server's bytes, typing under the client id its open was given. */
async function join(person: Person, regionId = rich) {
  const req = request(`/api/artifacts/${pageId}/regions/${regionId}/open`, { method: 'POST', actor: as(person), origin: 'same' });
  const response = await call(req, () => openRoute(req, { params: Promise.resolve({ id: pageId, regionId }) }));
  expect(response.status).toBe(200);
  const reply = await response.json() as { clientId: number; seq: number; state: string };
  const doc = openRegionDoc(Buffer.from(reply.state, 'base64'), { clientId: reply.clientId });
  const pending: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'server') pending.push(update); });
  return {
    reply, doc, text: regionText(doc),
    async push() {
      const update = Buffer.from(Y.mergeUpdates(pending.splice(0))).toString('base64');
      const sent = request(`/api/artifacts/${pageId}/regions/${regionId}/updates`, { method: 'POST', json: { clientId: reply.clientId, update }, actor: as(person), origin: 'same' });
      return (await call(sent, () => updatesRoute(sent, { params: Promise.resolve({ id: pageId, regionId }) }))).status;
    },
    receive(updates: string[]) { for (const update of updates) Y.applyUpdate(doc, Buffer.from(update, 'base64'), 'server'); },
    html: () => regionHtml('rich', Y.encodeStateAsUpdate(doc)),
  };
}

const streams: (() => void)[] = [];
async function stream(person: Person, after: string) {
  const abort = new AbortController();
  const req = attachActor(new Request(request(`/api/artifacts/${pageId}/regions/stream?after=${encodeURIComponent(after)}`), { signal: abort.signal }), as(person));
  const response = await call(req, () => streamRoute(req, { params: Promise.resolve({ id: pageId }) }));
  expect(response.status).toBe(200);
  const frames = sseStream(response.body!);
  streams.push(() => { abort.abort(); frames.close(); });
  return frames;
}
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

const savedRegion = async (regionId = rich) => editableRegions((await getArtifactById(pageId))!.source!).find((region) => region.id === regionId)!;
const head = async () => (await getArtifactById(pageId))!.version;

beforeEach(async () => {
  const person = async (name: string) => { const user = await createUser({ email: `mxmx_test_agentregions_${name}@example.com` }); return { id: user.id, email: user.email! }; };
  [owner, editor, viewer, stranger] = await Promise.all(['owner', 'editor', 'viewer', 'stranger'].map(person));
  const row = await createHistoricalPage(null, owner.id, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'private' });
  pageId = row.id;
  const regions = editableRegions(row.source!);
  rich = regions.find((region) => region.kind === 'rich')!.id;
  plain = regions.find((region) => region.kind === 'text')!.id;
  const q = await harness.db();
  for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) await q.query('INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, $3)', [pageId, who.email, role]);
  agent = (await mintAccountToken('regions-agent', owner.id)).token;
  viewerToken = (await mintAccountToken('regions-viewer', viewer.id)).token;
});
afterEach(() => {
  for (const close of streams.splice(0)) close();
  regionSessions().dispose();
});

describe('reading a region', () => {
  it('answers the saved region as Markdown (default) or HTML, with its version; `_doc` is the one rich region', async () => {
    expect(await read({ token: agent })).toEqual({ status: 200, body: { regionId: rich, kind: 'rich', version: 1, markdown: 'Hello world\n\n## Plan\n\nSecond paragraph' } });
    const html = await read({ token: agent }, rich, '?format=html');
    expect(html.body).toEqual({ regionId: rich, kind: 'rich', version: 1, html: (await savedRegion()).inner });
    expect((await read({ token: agent }, plain)).body).toEqual({ regionId: plain, kind: 'text', version: 1, markdown: 'Title' });
    expect((await read({ token: agent }, rich, '?format=svg')).status).toBe(400);
  });

  it('is the saved page: anyone who may read it reads it (viewer token, viewer session); others get the uniform 404', async () => {
    expect((await read({ token: viewerToken })).status).toBe(200);
    expect((await read({ person: viewer })).body.markdown).toContain('Hello world');
    for (const who of [{ person: stranger }, null] as Who[]) {
      const refused = await read(who);
      expect(refused.status === 404 || refused.status === 401, JSON.stringify(refused)).toBe(true);
      if (refused.status === 404) expect(refused.body).toEqual({ error: 'not_found' });
    }
    expect(await read({ token: agent }, '_doc', '', 'zzzzzzzz')).toEqual({ status: 404, body: { error: 'not_found' } });
  });

  it('includes unsaved typing: a reader reads it live with no version made; an editor\'s read saves it first', async () => {
    const b = await join(editor);
    b.text.insert(0, 'Typed ', {});
    expect(await b.push()).toBe(200);
    // A reader (who cannot write) reads the page as it is now, at the saved version.
    expect((await read({ token: viewerToken })).body).toMatchObject({ version: 1, markdown: expect.stringMatching(/^Typed Hello world/) });
    expect(await head()).toBe(1);
    expect(await flush({ token: viewerToken })).toEqual({ status: 404, body: { error: 'not_found' } });
    // An editor reads a saved version holding it (a checkpoint), so a write from that version merges from what it read.
    expect((await read({ token: agent })).body).toMatchObject({ version: 2, markdown: expect.stringMatching(/^Typed Hello world/) });
    expect(await head()).toBe(2);
    // Nothing unsaved: reading again makes no version.
    expect((await read({ token: agent })).body).toMatchObject({ version: 2 });
    expect(await flush({ token: agent })).toEqual({ status: 200, body: { version: 2 } });
    expect(await head()).toBe(2);
  });

  it('read then write while people type: nothing anyone typed is lost or applied twice', async () => {
    const b = await join(editor);
    const typed = async (at: number, text: string) => { b.text.insert(at, text, {}); expect(await b.push()).toBe(200); };
    await typed(0, 'Before the read. ');
    const { body: before } = await read({ token: agent });
    expect(before.markdown).toMatch(/^Before the read\. Hello world/);
    // People type on after the agent's read; the agent edits the text it read.
    await typed(b.text.toString().indexOf('Second paragraph'), 'After the read: ');
    const markdown = String(before.markdown).replace('Hello world', 'Hello agent world');
    const written = await write({ token: agent }, { markdown, base_version: before.version });
    expect(written.status).toBe(200);
    const text = String(written.body.markdown);
    expect(text).toBe('Before the read. Hello agent world\n\n## Plan\n\nAfter the read: Second paragraph');
    expect(text.match(/Before the read\./g)).toHaveLength(1);
  });

  it('names the regions there are when the path names none, or `_doc` is ambiguous', async () => {
    expect(await read({ token: agent }, 'nosuch')).toEqual({ status: 404, body: { error: 'region_not_found', regions: [{ regionId: plain, kind: 'text' }, { regionId: rich, kind: 'rich' }] } });
    const two = await createHistoricalPage(null, owner.id, { format: 'html', source: nativeHtml('<section data-af-editable="rich"><p>a</p></section><section data-af-editable="rich"><p>b</p></section>'), meta: {}, visibility: 'private' });
    const ambiguous = await read({ token: agent }, '_doc', '', two.id);
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error).toBe('region_ambiguous');
    expect((ambiguous.body.regions as unknown[]).length).toBe(2);
    const none = await createHistoricalPage(null, owner.id, { format: 'html', source: nativeHtml('<p>plain page</p>'), meta: {}, visibility: 'private' });
    expect(await read({ token: agent }, '_doc', '', none.id)).toEqual({ status: 404, body: { error: 'region_not_found', regions: [] } });
  });
});

describe('an agent writing a region while people type', () => {
  it('keeps the editor\'s unsaved typing and the agent\'s edit; the editor\'s stream gets the agent\'s update before the save', async () => {
    const b = await join(editor);
    const frames = await stream(editor, `${rich}:${b.reply.seq}`);
    const { body: before } = await read({ token: agent });
    b.text.insert(0, 'Editor typing. ', {});
    expect(await b.push()).toBe(200);
    // The agent edits the text it read (which never saw the editor's typing).
    const markdown = String(before.markdown).replace('Second paragraph', 'Second paragraph, revised by the agent.') + '\n\nA new closing line.';
    const written = await write({ token: agent }, { markdown, base_version: before.version });
    expect(written.status).toBe(200);
    expect(written.body).toMatchObject({ regionId: rich, kind: 'rich', version: 2 });
    expect(written.body.html).toContain('Editor typing. Hello world');
    expect(written.body.html).toContain('Second paragraph, revised by the agent.');
    expect(written.body.markdown).toBe('Editor typing. Hello world\n\n## Plan\n\nSecond paragraph, revised by the agent.\n\nA new closing line.');
    const saved = (await savedRegion()).inner;
    expect(saved).toBe(written.body.html);
    expect(await head()).toBe(2);
    // Live: the editor's stream carries the agent's update first, then the save; applied, their replica holds both.
    const seen = await framesUntil(frames, (frame) => frame.type === 'saved');
    const updates = seen.findIndex((frame) => frame.type === 'updates' && (frame.updates as string[]).length > 0 && (frame.to as number) > b.reply.seq + 1);
    expect(updates).toBeGreaterThanOrEqual(0);
    expect(updates).toBeLessThan(seen.findIndex((frame) => frame.type === 'saved'));
    expect(seen.at(-1)).toMatchObject({ type: 'saved', version: 2 });
    for (const frame of seen) if (frame.type === 'updates') b.receive(frame.updates as string[]);
    expect(b.text.toString()).toContain('Editor typing. Hello world');
    expect(b.text.toString()).toContain('revised by the agent.');
    expect(b.html()).toBe(saved);
    // The agent's update is logged as the agent's (its token), the editor's as theirs.
    const actors = (await (await harness.db()).query<{ actor_token_id: string | null; actor_user_id: string }>('SELECT actor_user_id, actor_token_id FROM region_updates WHERE artifact_id = $1 ORDER BY seq', [pageId])).rows;
    expect(actors.some((row) => row.actor_user_id === owner.id && row.actor_token_id)).toBe(true);
    expect(actors.some((row) => row.actor_user_id === editor.id && !row.actor_token_id)).toBe(true);
  });

  it('two agents writing from the same version both land; an unchanged write adds no version', async () => {
    const { body } = await read({ token: agent });
    const first = await write({ token: agent }, { markdown: `${body.markdown}\n\nFirst agent.`, base_version: body.version });
    const second = await write({ token: agent }, { markdown: String(body.markdown).replace('Hello world', 'Hello there world'), base_version: body.version });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.markdown).toBe('Hello there world\n\n## Plan\n\nSecond paragraph\n\nFirst agent.');
    const unchanged = await write({ token: agent }, { markdown: second.body.markdown, base_version: second.body.version });
    expect(unchanged.body.version).toBe(second.body.version);
    expect(await head()).toBe(3);
  });

  it('writes before anyone opened the region, by HTML or into a text region, and from a browser session', async () => {
    const html = await write({ token: agent }, { html: '<p>Replaced by <strong>HTML</strong></p>', base_version: 1 }, rich);
    expect(html.body).toMatchObject({ version: 2, html: expect.stringContaining('Replaced by <strong>HTML</strong>') });
    expect(html.body).not.toHaveProperty('markdown');
    // A text region is one line of plain text: emphasis is refused by name; escaped Markdown is literal text.
    expect(await write({ person: editor }, { markdown: 'New *title*', base_version: 2 }, plain)).toEqual({ status: 422, body: { error: 'unsupported_content', details: ['<em>'] } });
    const title = await write({ person: editor }, { markdown: 'New \\*title\\*', base_version: 2 }, plain);
    expect(title.status).toBe(200);
    expect((await savedRegion(plain)).inner).toBe('New *title*');
  });

  it('an Idempotency-Key retry answers the same reply and writes once', async () => {
    const headers = { 'Idempotency-Key': 'region-write-key-0001' };
    const once = await write({ token: agent }, { markdown: 'Only once.', base_version: 1 }, '_doc', headers);
    const again = await write({ token: agent }, { markdown: 'Only once.', base_version: 1 }, '_doc', headers);
    expect(once.status).toBe(200);
    expect(again).toEqual(once);
    expect(await head()).toBe(2);
    const changed = await write({ token: agent }, { markdown: 'Something else.', base_version: 1 }, '_doc', headers);
    expect([changed.status, changed.body.error]).toEqual([409, 'idempotency_mismatch']);
  });
});

describe('refusals', () => {
  it('readers, strangers and unknown pages get the uniform 404; nothing is written', async () => {
    for (const who of [{ token: viewerToken }, { person: viewer }, { person: stranger }] as Who[]) {
      expect(await write(who, { markdown: 'x', base_version: 1 })).toEqual({ status: 404, body: { error: 'not_found' } });
    }
    expect(await write({ token: agent }, { markdown: 'x', base_version: 1 }, '_doc', {}, 'zzzzzzzz')).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(await head()).toBe(1);
  });

  it('a base version with no snapshot is region_snapshot_missing, naming the head to read again from', async () => {
    expect(await write({ token: agent }, { markdown: 'x', base_version: 7 })).toEqual({ status: 409, body: { error: 'region_snapshot_missing', version: 1 } });
    // Snapshots exist from the version a region's live state began at: version 1 here, so a write made from it merges.
    await write({ token: agent }, { markdown: 'Hello world\n\nv2', base_version: 1 });
    const q = await harness.db();
    await q.query('DELETE FROM region_snapshots WHERE artifact_id = $1 AND version = 1', [pageId]);
    expect(await write({ token: agent }, { markdown: 'stale', base_version: 1 })).toEqual({ status: 409, body: { error: 'region_snapshot_missing', version: 2 } });
  });

  it('content the region cannot hold is unsupported_content, with details; a malformed write is invalid_region_write', async () => {
    const refused = await write({ token: agent }, { markdown: '![chart](x.png)\n\nline  \nbreak', base_version: 1 });
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({ error: 'unsupported_content', details: ['<img>', '<br>'] });
    for (const body of [{ base_version: 1 }, { markdown: 'a', html: '<p>a</p>', base_version: 1 }, { markdown: 'a' }, { markdown: 'a', base_version: 0 }, { markdown: 7, base_version: 1 }]) {
      expect(await write({ token: agent }, body), JSON.stringify(body)).toEqual({ status: 400, body: { error: 'invalid_region_write' } });
    }
    expect(await head()).toBe(1);
  });
});

it('native agent revisions keep the versioned XML root and remain editable through the authenticated session door',async()=>{
 const row=await createArtifact(null,owner.id,{format:'html',source:nativeHtml('<article data-af-editable="rich-native-v1"><p>Keep</p><ul><li><p>Nested</p></li></ul></article>'),meta:{},visibility:'private'});
 const readBack=await read({person:owner},'_doc','',row.id);
 expect(readBack.status).toBe(200);
 const written=await write({person:owner},{base_version:readBack.body.version,markdown:'Added\n\nKeep\n\n- Nested'},'_doc',{},row.id);
 expect(written.status).toBe(200);
 const regionId=String(written.body.regionId);
 const req=request(`/api/artifacts/${row.id}/regions/${regionId}/open`,{method:'POST',actor:as(owner),origin:'same'});
 const response=await call(req,()=>openRoute(req,{params:Promise.resolve({id:row.id,regionId})}));
 expect(response.status).toBe(200);
 const reply=await response.json() as {state:string;clientId:number};
 const doc=openRegionDoc(Buffer.from(reply.state,'base64'),{kind:'rich-native-v1',clientId:reply.clientId});
 expect([...doc.share.keys()]).toEqual(['native-v1']);
 const vector=Y.encodeStateVector(doc);
 ((doc.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0,'Live ');
 const sent=request(`/api/artifacts/${row.id}/regions/${regionId}/updates`,{method:'POST',actor:as(owner),origin:'same',json:{clientId:reply.clientId,update:Buffer.from(Y.encodeStateAsUpdate(doc,vector)).toString('base64')}});
 expect((await call(sent,()=>updatesRoute(sent,{params:Promise.resolve({id:row.id,regionId})}))).status).toBe(200);
});
