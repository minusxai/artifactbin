/**
 * A PUBLISHED PAGE'S SCRIPT NEVER FAILS SILENTLY. A version stored under an earlier API (its Helmet script
 * imports a `page` export that no longer exists) still prepares and serves — the rest of the page whole — and
 * the failure is part of what is stored for that version: the reader's copy says the script could not load,
 * the app page tells someone who may edit it why and what fixes it, and the operator's log names the version.
 *
 * Real routes on the harness's isolated database. The broken version is written the way an earlier deployment
 * stored it (the document graph, straight into the row), since publishing refuses such a script today.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { framedDocument, request, setSession, useAppHarness, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { artifactPageAnswer } from '@/lib/serving';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { createDocumentGraph } from '@/lib/document/document-graph';
import { READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { ISLAND_DATA_ID, SCRIPT_FAILURE_ATTR } from '@/lib/story-runtime/contract';

const harness = useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const raw = (id: string) => rawRoute(request(`/a/${id}/raw`), params(id));

/** Valid today: the declared Value bound through `signal` (lib/author-script). */
const VALID = '<Helmet><Value name="n" type="number" default={0} /><script>{`import { signal } from "page"; const [n, setN] = signal("$n"); setN(n() + 1);`}</script></Helmet>'
  + '<h1 id="title">Wireframe</h1><p id="rest">Everything else on the page</p><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList><TabsContent value="a">Tab body</TabsContent></Tabs>';
/** The same page as stored before `reviewState` left the `page` module (#492): it does not build under today's API. */
const REMOVED_EXPORT_SCRIPT = 'import { reviewState } from "page"; const [open, setOpen] = reviewState("open", false); setOpen(!open());';
const BROKEN = VALID.replace(/<script>[\s\S]*<\/script>/, `<script>{\`${REMOVED_EXPORT_SCRIPT}\`}</script>`);

let session: { id: string; email: string } | null = null;
beforeEach(() => { session = null; setSession(() => (session ? { user: { id: session.id, email: session.email } } : null)); });
afterEach(() => vi.restoreAllMocks());

async function person(tag: string) {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_script_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('script-failure', user.id); await claimToken(user.id, t.token);
  return { user, token: t.token };
}
async function publish(token: string, markup: string): Promise<Response> {
  return createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { title: 'Wireframe', markup, visibility: 'public' } }));
}
async function published(token: string, markup: string): Promise<string> {
  const made = await publish(token, markup);
  if (made.status !== 201) throw new Error(await made.text());
  const { id } = await made.json() as { id: string };
  await drainPreparedPageWarmups();
  return id;
}
/** A head version stored with the removed export, and no prepared page yet (the first read after the API change prepares it). */
async function storedBroken() {
  const owner = await person('owner');
  const id = await published(owner.token, VALID);
  const db = await harness.db();
  const { version } = (await getArtifactById(id))!;
  await db.query('UPDATE artifacts SET document = $2::jsonb WHERE id = $1', [id, JSON.stringify(createDocumentGraph(BROKEN, version))]);
  await db.query('DELETE FROM prepared_pages WHERE artifact_id = $1', [id]);
  return { owner, id, version };
}
const stored = async (id: string) => (await (await harness.db()).query<{ errors: string[] | null; has: boolean }>(
  `SELECT page->'authorScriptErrors' AS errors, page ? 'authorScriptErrors' AS has FROM prepared_pages WHERE artifact_id = $1 AND slot = 'head'`, [id],
)).rows[0]!;
const dom = (html: string) => new JSDOM(html).window.document;
const notice = (doc: Document) => doc.querySelector<HTMLElement>('[role="status"][aria-label="Page script unavailable"]');
const islandScript = (doc: Document) => (JSON.parse(doc.getElementById(ISLAND_DATA_ID)?.textContent || '{}') as { authorScript?: string | null }).authorScript ?? null;
const pageBody = async (id: string) => {
  const answer = await artifactPageAnswer(request(`/a/${id}`), id);
  expect(answer.status).toBe(200);
  return answer.body as { scriptFailure?: { errors: string[] } };
};

describe('a stored version whose script no longer builds', () => {
  it('is served whole, with the failure recorded for the version, a reader notice and an error log naming it', async () => {
    const { id, version } = await storedBroken();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await raw(id);
    expect(res.status).toBe(200);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const doc = dom(await res.text());

    // Nothing else on the page is lost: its markup, its kit and the reader's document are all there.
    expect(doc.getElementById('title')?.textContent).toBe('Wireframe');
    expect(doc.getElementById('rest')?.textContent).toBe('Everything else on the page');
    expect(doc.querySelector('#mx-story-root [role="tablist"]')).toBeTruthy();
    // …but not the script that does not build.
    expect(islandScript(doc)).toBeNull();

    // The reader is told, outside the story (the hydrated tree never sees it), without the builder's detail.
    const shown = notice(doc);
    expect(shown?.hasAttribute(SCRIPT_FAILURE_ATTR)).toBe(true);
    expect(shown?.textContent).toMatch(/script could not load/i);
    expect(shown?.textContent).not.toMatch(/reviewState/);
    expect(shown?.closest('#mx-story-root')).toBeNull();

    // Recorded with the version, the builder's own message.
    const record = await stored(id);
    expect(record.errors?.join('\n')).toMatch(/reviewState/);

    // An error-level line names the document and the version, never the source.
    const lines = logged.mock.calls.map((call) => call.map(String).join(' ')).filter((line) => line.includes(id));
    expect(lines.some((line) => line.includes(`v${version}`) && /reviewState/.test(line))).toBe(true);
    for (const line of lines) expect(line).not.toContain(REMOVED_EXPORT_SCRIPT);
  });

  it('says so on the document\'s own origin the app page frames', async () => {
    const { id } = await storedBroken();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const framed = await framedDocument(app, `/a/${id}`, { headers: { accept: 'text/html' } });
    expect(framed?.status).toBe(200);
    const doc = dom(await framed!.text());
    expect(notice(doc)).toBeTruthy();
    expect(doc.getElementById('rest')?.textContent).toBe('Everything else on the page');
  });

  it('tells someone who may edit it the builder\'s message, and no reader', async () => {
    const { owner, id } = await storedBroken();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await pageBody(id)).not.toHaveProperty('scriptFailure');
    const reader = await person('reader');
    session = { id: reader.user.id, email: reader.user.email! };
    expect(await pageBody(id)).not.toHaveProperty('scriptFailure');
    session = { id: owner.user.id, email: owner.user.email! };
    const body = await pageBody(id);
    expect(body.scriptFailure?.errors.join('\n')).toMatch(/reviewState/);
  });

  it('a page stored silently by an earlier deployment records the failure on its next read', async () => {
    const { id } = await storedBroken();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await raw(id);
    // As an earlier deployment stored it: the script dropped, nothing recorded.
    await (await harness.db()).query(`UPDATE prepared_pages SET page = page - 'authorScriptErrors' WHERE artifact_id = $1`, [id]);
    expect((await stored(id)).has).toBe(false);
    const doc = dom(await (await raw(id)).text());
    expect(notice(doc)).toBeTruthy();
    expect((await stored(id)).errors?.join('\n')).toMatch(/reviewState/);
  });
});

describe('a version whose script builds', () => {
  it('carries no notice, no record and no editor message', async () => {
    const owner = await person('valid');
    const id = await published(owner.token, VALID);
    const doc = dom(await (await raw(id)).text());
    expect(doc.querySelector(`[${SCRIPT_FAILURE_ATTR}]`)).toBeNull();
    expect(islandScript(doc)).toContain('setN(n() + 1)');
    expect((await stored(id)).has).toBe(false);
    session = { id: owner.user.id, email: owner.user.email! };
    expect(await pageBody(id)).not.toHaveProperty('scriptFailure');
  });
});

describe('publishing a script that does not build', () => {
  it('is still refused by name, with the builder\'s message (no compatibility alias)', async () => {
    const owner = await person('refused');
    const res = await publish(owner.token, BROKEN);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: Array<{ message: string }> };
    expect(body.error).toBe('invalid_script');
    expect(body.details.map((d) => d.message).join('\n')).toMatch(/reviewState/);
  });
});
