import {createHistoricalPage} from './historical-page';
/**
 * LIVE TEXT IS THE DOCUMENT (lib/artifacts current-page): every read of an HTML page serves its saved source with each
 * region's unsaved live text composed in, with no save. The served document, the app page, the API GETs, a reader's
 * stream (a live ping per change, throttled) and a whole-page write made from what was read all agree on it, and no
 * version is made by typing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUser, identityForUser } from '@/lib/accounts';
import { artifactState, currentPage, getArtifactById } from '@/lib/artifacts';
import { editableRegions, openRegionDoc, regionText } from '@/lib/live-regions';
import { runWithRequest } from '@/lib/platform';
import type { Actor } from '@artifactbin/contracts';
import { POST as openRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/open/route';
import { POST as updatesRoute } from '@/app/api/artifacts/[id]/regions/[regionId]/updates/route';
import { regionSessions } from '@/app/api/artifacts/[id]/regions/doors';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as apiGet, PATCH as apiPatch, PUT as apiPut } from '@/app/api/artifacts/[id]/route';
import { GET as myGet, PUT as myPut } from '@/app/api/my/artifacts/[id]/route';
import { mintAccountToken, request, useAppHarness } from './harness';
import { sseStream } from './sse';

const harness = useAppHarness();

const DOC = '<!doctype html><html><head><title>Untitled document</title></head><body><main><article data-af-editable="rich"><h1></h1><p></p></article></main></body></html>';
type Person = { id: string; email: string };
let owner: Person, editor: Person, readerToken: string, ownerToken: string, pageId: string, regionId: string;
const as = (person: Person): Actor => ({ credential: 'session', userId: person.id, email: person.email, emailVerified: true });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** An editor's replica, typing through the real doors under the client id its open was given. */
async function join(person: Person) {
  const req = request(`/api/artifacts/${pageId}/regions/${regionId}/open`, { method: 'POST', actor: as(person), origin: 'same' });
  const response = await runWithRequest(req, () => openRoute(req, { params: Promise.resolve({ id: pageId, regionId }) }));
  expect(response.status).toBe(200);
  const reply = await response.json() as { clientId: number; state: string;kind: 'rich-native-v1'|'rich' };
  const doc = openRegionDoc(Buffer.from(reply.state, 'base64'), {kind:reply.kind, clientId: reply.clientId });
  const pending: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'server') pending.push(update); });
  return {
    text: reply.kind==='rich-native-v1'?(doc.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText:regionText(doc),
    async push() {
      const update = Buffer.from(Y.mergeUpdates(pending.splice(0))).toString('base64');
      const sent = request(`/api/artifacts/${pageId}/regions/${regionId}/updates`, { method: 'POST', json: { clientId: reply.clientId, update }, actor: as(person), origin: 'same' });
      expect((await runWithRequest(sent, () => updatesRoute(sent, { params: Promise.resolve({ id: pageId, regionId }) }))).status).toBe(200);
    },
  };
}
/** Types `text` at the end of the region's text (the doc's empty paragraph). */
async function typeAtEnd(editorOf: Awaited<ReturnType<typeof join>>, text: string) {
  editorOf.text.insert(editorOf.text.length - 1, text, {});
  await editorOf.push();
}
const saved = async () => (await getArtifactById(pageId))!;
const raw = async (headers: Record<string, string> = {}) => rawRoute(request(`/a/${pageId}/raw`, { headers }), params(pageId));
const runtimeOf = (html: string) => JSON.parse(/<script[^>]*data-af="runtime"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!.replace(/\\u003c/g, '<')) as { revision: string; live?: number; savedNodeIds: string[] };

beforeEach(async () => {
  const person = async (name: string) => { const user = await createUser({ email: `mxmx_test_livedocs_${name}@example.com` }); return { id: user.id, email: user.email! }; };
  [owner, editor] = await Promise.all(['owner', 'editor'].map(person));
  const row = await createHistoricalPage(null, owner.id, { format: 'html', source: DOC, title: 'Untitled document', meta: { template: 'doc' }, visibility: 'public' });
  pageId = row.id;
  regionId = editableRegions(row.source!)[0]!.id;
  await (await harness.db()).query('INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, $3)', [pageId, editor.email, 'editor']);
  ownerToken = (await mintAccountToken('livedocs-owner', owner.id)).token;
  readerToken = (await mintAccountToken('livedocs-reader')).token;
});
afterEach(() => regionSessions().dispose());

describe('the current page', () => {
  it('is the saved source with the live text composed in, named by its live heading; nothing is saved', async () => {
    const typist = await join(owner);
    typist.text.insert(0, 'Launch plan', {});
    await typist.push();
    await typeAtEnd(typist, 'First line of the body.');
    const row = await saved();
    expect(row.version).toBe(1);
    expect(row.source).not.toContain('Launch plan');
    const page = await currentPage(row);
    expect(page.composed).toBe(true);
    expect(page.row.source).toMatch(/<h1[^>]*>Launch plan<\/h1><p[^>]*>First line of the body.<\/p>/);
    expect(page.row.title).toBe('Launch plan');
    expect(page.row.source).toMatch(/<title[^>]*>Launch plan<\/title>/);
    const seqs = (await (await harness.db()).query<{ last_seq: number }>('SELECT last_seq::int AS last_seq FROM region_states WHERE artifact_id = $1', [pageId])).rows;
    expect(page.live).toBe(seqs.reduce((sum, row) => sum + row.last_seq, 0));
    expect((await saved()).version).toBe(1);
    // A save makes exactly the page composed (the same pure compaction), and the page is then clean.
    const flushed = await regionSessions().flush(identityForUser(owner.id, null), pageId);
    expect(flushed).toEqual({ status: 200, body: { version: 2 } });
    const after = await saved();
    expect(after.source).toBe(page.row.source);
    expect(after.title).toBe('Launch plan');
    expect((await currentPage(after)).composed).toBe(false);
  });

  it('gives a block typed since the last save a provisional id, and is cached by version and each region\'s sequence', async () => {
    const typist = await join(owner);
    typist.text.insert(0, 'Plan', {});
    await typist.push();
    await typeAtEnd(typist, 'one\ntwo');
    const first = await currentPage(await saved());
    // A block the save would identify is identified now, but only provisionally: the next save may give its id away.
    expect(first.unsavedIds.size).toBeGreaterThan(0);
    for (const id of first.unsavedIds) expect((await saved()).source).not.toContain(`"${id}"`);
    // The cache answers the same (version, sequences) without composing again: altering the stored state under the
    // same sequence changes nothing served.
    const q = await harness.db();
    const [stored] = (await q.query<{ state: Uint8Array; state_seq: number }>('SELECT state, state_seq::int AS state_seq FROM region_states WHERE artifact_id = $1', [pageId])).rows;
    await q.query('UPDATE region_states SET state = $2, state_seq = last_seq WHERE artifact_id = $1', [pageId, Buffer.from(Y.encodeStateAsUpdate(openRegionDoc()))]);
    expect((await currentPage(await saved())).row.source).toBe(first.row.source);
    // A new sequence is a new composition.
    await q.query('UPDATE region_states SET state = $2, state_seq = $3 WHERE artifact_id = $1', [pageId, Buffer.from(stored!.state), stored!.state_seq]);
    await typeAtEnd(typist, ' three');
    const next = await currentPage(await saved());
    expect(next.row.source).toContain('two three');
    expect(next.live).toBeGreaterThan(first.live);
  });
  it('stops naming a renamed doc by its live heading at once (a rename is no new version)', async () => {
    const typist = await join(owner);
    typist.text.insert(0, 'Heading name', {});
    await typist.push();
    expect(await regionSessions().flush(identityForUser(owner.id, null), pageId)).toEqual({ status: 200, body: { version: 2 } });
    // Named by its saved heading, it follows the heading as typed live.
    typist.text.insert('Heading name'.length, ' v2', {});
    await typist.push();
    expect((await currentPage(await saved())).row.title).toBe('Heading name v2');
    const state = artifactState(await saved());
    const rename = request(`/api/artifacts/${pageId}`, { method: 'PATCH', token: ownerToken, json: { title: 'Board memo', expectedState: state } });
    expect((await runWithRequest(rename, () => apiPatch(rename, params(pageId)))).status).toBe(200);
    expect((await currentPage(await saved())).row.title).toBe('Board memo');
  });
});

describe('every read path serves it', () => {
  it('the raw document (and a revalidation, and the shared render cache) holds the live text and its live revision', async () => {
    const typist = await join(editor);
    typist.text.insert(0, 'Hello readers', {});
    await typist.push();
    await typeAtEnd(typist, 'a new block\nand another');
    const first = await raw();
    expect(first.status).toBe(200);
    const html = await first.text();
    expect(html).toContain('Hello readers');
    const config = runtimeOf(html);
    expect(config.revision).toBe('1');
    expect(config.live).toBe((await currentPage(await saved())).live);
    // Provisional ids are drawn but never offered as anchors (a comment anchors to the saved version).
    const page = await currentPage(await saved());
    expect(page.unsavedIds.size).toBeGreaterThan(0);
    for (const id of page.unsavedIds) { expect(html).toContain(`data-af-id="${id}"`); expect(config.savedNodeIds).not.toContain(id); }
    expect(config.savedNodeIds).toContain(regionId);
    // A second anonymous read (the shared render) follows further typing.
    await typeAtEnd(typist, ' and more');
    const second = await (await raw()).text();
    expect(second).toContain('and more');
    expect(runtimeOf(second).live).toBeGreaterThan(config.live!);
  });

  it('the API GET: a reader reads the live text with no version made; an editor\'s read saves it first (a checkpoint)', async () => {
    const typist = await join(editor);
    typist.text.insert(0, 'Typed live', {});
    await typist.push();
    const asReader = request(`/api/artifacts/${pageId}`, { token: readerToken });
    const read = await runWithRequest(asReader, () => apiGet(asReader, params(pageId)));
    expect(read.status).toBe(200);
    const body = await read.json() as { html: string; title: string; version: number; live: number };
    expect(body.html).toContain('Typed live');
    expect(body.title).toBe('Typed live');
    expect(body.version).toBe(1);
    expect(body.live).toBeGreaterThan(0);
    expect((await saved()).version).toBe(1);
    const asOwner = request(`/api/artifacts/${pageId}`, { token: ownerToken });
    const owned = await (await runWithRequest(asOwner, () => apiGet(asOwner, params(pageId)))).json() as { html: string; version: number };
    expect(owned).toMatchObject({ version: 2, html: expect.stringContaining('Typed live') });
    expect((await saved()).source).toContain('Typed live');
  });

  it('a signed-out reader\'s stream pings live text (with its title and live revision), throttled, with no version', async () => {
    const opened = await eventsRoute(request(`/a/${pageId}/events`), params(pageId));
    expect(opened.status).toBe(200);
    const frames = sseStream(opened.body!);
    try {
      const [opening] = await frames.named('message', 1);
      expect(opening!.data).toMatchObject({ version: 1, live: 0 });
      const typist = await join(editor);
      typist.text.insert(0, 'Live title', {});
      await typist.push();
      const [ping] = await frames.named('message', 1);
      expect(ping!.data).toMatchObject({ version: 1, title: 'Live title', by: null });
      expect(ping!.data.live as number).toBeGreaterThan(0);
      // A burst of typing inside one throttle window comes out as at most two pings (leading and trailing).
      const startedAt = Date.now();
      for (const word of [' one', ' two', ' three', ' four']) await typeAtEnd(typist, word);
      const burst = await frames.named('message', 3, 1200);
      const within = Date.now() - startedAt;
      expect(burst.length).toBeGreaterThanOrEqual(1);
      expect(burst.length).toBeLessThanOrEqual(Math.ceil(within / 300) + 1);
      expect(burst.at(-1)!.data.live as number).toBe((await currentPage(await saved())).live);
      expect((await saved()).version).toBe(1);
      // A new version starts its live revisions afresh: a whole-page write closing the region sums to less than the
      // live text before it, and the live text typed after it still reaches the reader.
      const before = burst.at(-1)!.data.live as number;
      const owned = request(`/api/artifacts/${pageId}`, { token: ownerToken });
      const head = await (await runWithRequest(owned, () => apiGet(owned, params(pageId)))).json() as { html: string; version: number; state: string };
      const put = request(`/api/artifacts/${pageId}`, { method: 'PUT', token: ownerToken, json: { html: head.html.replace(/<article[\s\S]*<\/article>/, '<article data-af-editable="rich" data-af-id="fresh"><p>New region.</p></article>'), expectedVersion: head.version, expectedState: head.state } });
      expect((await runWithRequest(put, () => apiPut(put, params(pageId)))).status).toBe(200);
      let version: Record<string, unknown> | undefined;
      for (let read = 0; read < 4 && version?.version !== 3; read++) version = (await frames.named('message', 1))[0]?.data;
      expect(version).toMatchObject({ version: 3, live: 0 });
      regionId = 'fresh';
      const next = await join(editor);
      next.text.insert(0, 'After ', {});
      await next.push();
      const [after] = await frames.named('message', 1);
      expect(after!.data).toMatchObject({ version: 3 });
      expect(after!.data.live as number).toBeGreaterThan(0);
      expect(after!.data.live as number).toBeLessThan(before);
    } finally { frames.close(); }
  });
});

describe('a whole-page write made from the live text', () => {
  async function head(person: Person) {
    const req = request(`/api/my/artifacts/${pageId}`, { actor: as(person), origin: 'same' });
    return await (await runWithRequest(req, () => myGet(req, params(pageId)))).json() as { html: string; version: number; state: string; live: number };
  }
  async function put(person: Person, body: Record<string, unknown>) {
    const req = request(`/api/my/artifacts/${pageId}`, { method: 'PUT', json: body, actor: as(person), origin: 'same' });
    const response = await runWithRequest(req, () => myPut(req, params(pageId)));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it('with its live revision merges from the live state: nothing typed is applied twice', async () => {
    const typist = await join(editor);
    typist.text.insert(0, 'Agenda', {});
    await typist.push();
    await typeAtEnd(typist, 'Item typed live.');
    const read = await head(owner);
    expect(read.html).toContain('Item typed live.');
    // A settings change elsewhere in the page, the region sent back as read.
    const html = read.html.replace(/(<title[^>]*>Agenda<\/title>)/, '$1<meta name="description" content="x">');
    expect(html).toContain('name="description"');
    const written = await put(owner, { html, expectedVersion: read.version, expectedState: read.state, expectedLive: read.live });
    expect(written.status, JSON.stringify(written.body)).toBe(200);
    const after = await saved();
    expect(after.source!.match(/Item typed live\./g)).toHaveLength(1);
    expect(after.source!.match(/Agenda<\/h1>/g)).toHaveLength(1);
    expect(after.source).toContain('name="description"');
  });

  it('refuses (content conflict) once more typing moved the live text past what it read', async () => {
    const typist = await join(editor);
    typist.text.insert(0, 'Draft', {});
    await typist.push();
    const read = await head(owner);
    await typeAtEnd(typist, 'More typed after the read.');
    const written = await put(owner, { html: read.html, expectedVersion: read.version, expectedState: read.state, expectedLive: read.live });
    expect(written.status).toBe(409);
    expect(written.body).toMatchObject({ error: 'version_conflict', changed: 'content' });
    expect((await saved()).version).toBe(1);
  });
});

describe('cost', () => {
  it('composing a 50k-character region, uncached and cached', async () => {
    const typist = await join(owner);
    const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);
    typist.text.insert(0, 'Long doc', {});
    for (let i = 0; i < 90; i++) typist.text.insert(typist.text.length - 1, `${paragraph}\n`, {});
    await typist.push();
    expect(typist.text.length).toBeGreaterThan(50_000);
    const row = await saved();
    let started = performance.now();
    const uncached = await currentPage(row);
    const uncachedMs = performance.now() - started;
    started = performance.now();
    const cached = await currentPage(row);
    const cachedMs = performance.now() - started;
    expect(cached.row.source).toBe(uncached.row.source);
    expect(uncached.row.source!.length).toBeGreaterThan(50_000);
    process.stderr.write(`[live-docs cost] 50k-char region: uncached ${uncachedMs.toFixed(1)} ms, cached ${cachedMs.toFixed(2)} ms\n`);
    expect(cachedMs).toBeLessThan(uncachedMs);
  });
});
