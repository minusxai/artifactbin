/**
 * "New" makes a DOC (lib/workspace artifactStarter): a private page owned by its creator whose whole body is ONE rich
 * editable region, marked `template: 'doc'` so its editors' page opens that region on load. Through the real create,
 * replace, metadata and region-session doors: what is stored, that an untouched doc stays version 1 when an editor opens
 * and leaves it, that its name follows its first heading on a region save until it is renamed, that an agent's whole-page
 * write keeps it a doc, and that the agent handoff (`/api/start`) still makes the placeholder starter exactly as before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { POST as createBrowserArtifact } from '@/app/api/my/artifacts/route';
import { POST as startRoute } from '@/app/api/start/route';
import { GET as read, PATCH as patch, PUT as replace } from '@/app/api/artifacts/[id]/route';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { autofixHtml } from '@/lib/html-autofix';
import { editableRegions, regionText } from '@/lib/live-regions';
import { createRegionSessions, type RegionSessions } from '@/lib/region-sessions';
import { getDb } from '@/lib/platform';
import { listOwnedArtifacts } from '@/lib/workspace';
import { artifactStarter } from '@/lib/workspace/artifact-starters';
import { mintAccountToken, request, useAppHarness } from './harness';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const clock = {
  now: () => Date.now(), setInterval: () => 0, clearInterval: () => {},
  setTimeout: (work: () => void, ms: number) => setTimeout(work, ms),
  clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
let sessions: RegionSessions | null = null;
const aborts: AbortController[] = [];
afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await sessions?.settle();
  sessions?.dispose();
  sessions = null;
});
function regionSessions(): RegionSessions {
  sessions = createRegionSessions({
    db: getDb, keepaliveFrame: () => 'event: keepalive\ndata: {}\n\n', clock, idleCheckMs: 60_000, leaveGraceMs: 0,
    subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost),
  });
  return sessions;
}

/** A doc made through the browser's create door, as the Create menu's "Document" and `/start` send it. */
async function newDoc(label: string) {
  const account = await mintAccountToken(label);
  const actor = { credential: 'session' as const, userId: account.userId!, email: account.email!, emailVerified: true };
  const response = await createBrowserArtifact(request('/api/my/artifacts', { method: 'POST', actor, json: artifactStarter('doc') }));
  expect(response.status).toBe(201);
  const id = (await response.json()).id as string;
  return { userId: account.userId!, token: account.token, id, owner: identityForUser(account.userId!, null) as AccessActor, row: (await getArtifactById(id))! };
}
/** Types `text` at the region's start (into its first block, the title) through a real session. */
async function typeAtStart(live: RegionSessions, owner: AccessActor, id: string, regionId: string, text: string) {
  const opened = await live.open(owner, id, regionId);
  if (opened.status !== 200) throw new Error(`open ${opened.status}`);
  const doc = new Y.Doc();
  doc.clientID = opened.body.clientId;
  Y.applyUpdate(doc, Buffer.from(opened.body.state, 'base64'));
  const before = Y.encodeStateVector(doc);
  regionText(doc).insert(0, text, {});
  expect((await live.update(owner, id, regionId, { clientId: opened.body.clientId, update: Y.encodeStateAsUpdate(doc, before) })).status).toBe(200);
}
const flush = async (live: RegionSessions, owner: AccessActor, id: string) => {
  const saved = await live.flush(owner, id);
  if (saved.status !== 200) throw new Error(`flush ${saved.status}`);
  return saved.body.version;
};
const titleTag = (html: string | null) => /<title[^>]*>([^<]*)<\/title>/.exec(html ?? '')?.[1];

describe('a new doc', () => {
  it('is a private page of its creator, marked a doc, whose body is one rich region with an empty title block', async () => {
    const { userId, row } = await newDoc('doc_shape');
    expect(row).toMatchObject({ format: 'html', user_id: userId, visibility: 'private', version: 1, title: 'Untitled document' });
    expect(row.meta).toMatchObject({ template: 'doc' });
    expect(row.meta.startPlaceholder).toBeUndefined();
    expect(titleTag(row.source)).toBe('Untitled document');
    expect(row.source).toMatch(/<meta name="artifactbin:design-system" content="meridian"[^>]*>/);
    const regions = editableRegions(row.source!);
    expect(regions).toEqual([expect.objectContaining({ kind: 'rich' })]);
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(row.source!)?.[1] ?? '';
    expect(body).toMatch(/^<main data-af-id="[^"]+"><article data-af-editable="rich" data-af-id="[^"]+"><h1 data-af-id="[^"]+"><\/h1><p data-af-id="[^"]+"><\/p><\/article><\/main>$/);
  });

  it('passes the publish autofix untouched, with nothing refused', () => {
    const { html } = artifactStarter('doc');
    const fixed = autofixHtml(html);
    expect(fixed.problems).toEqual([]);
    expect(fixed.fixes).toEqual([]);
    expect(fixed.html).toBe(html);
  });

  it('stays version 1 when its editor opens it and leaves without typing', async () => {
    const { owner, id, row } = await newDoc('doc_untouched');
    const live = regionSessions();
    const regionId = editableRegions(row.source!)[0]!.id;
    const abort = new AbortController();
    aborts.push(abort);
    const stream = await live.stream(owner, id, `${regionId}:0`, abort.signal);
    expect(stream.status).toBe('open');
    if (stream.status === 'open') void stream.stream.pipeTo(new WritableStream()).catch(() => {});
    expect((await live.open(owner, id, regionId)).status).toBe(200);
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await live.settle();
    expect(await flush(live, owner, id)).toBe(1);
    const after = (await getArtifactById(id))!;
    expect(after.version).toBe(1);
    expect(after.source).toBe(row.source);
  });

  it('lists like any untouched starter: once, under its untitled name', async () => {
    const { userId, id } = await newDoc('doc_listed');
    const listed = (await listOwnedArtifacts('user_id', userId)).filter((summary) => summary.id === id);
    expect(listed).toEqual([expect.objectContaining({ id, title: 'Untitled document' })]);
  });

  it('is named by its first heading on each region save, until it is renamed', async () => {
    const { owner, token, id, row } = await newDoc('doc_title');
    const live = regionSessions();
    const regionId = editableRegions(row.source!)[0]!.id;
    await typeAtStart(live, owner, id, regionId, 'Q3 plan');
    expect(await flush(live, owner, id)).toBe(2);
    let saved = (await getArtifactById(id))!;
    expect(saved.title).toBe('Q3 plan');
    expect(titleTag(saved.source)).toBe('Q3 plan');
    expect(saved.source).toMatch(/<h1 data-af-id="[^"]+">Q3 plan<\/h1>/);

    await typeAtStart(live, owner, id, regionId, 'Draft: ');
    expect(await flush(live, owner, id)).toBe(3);
    saved = (await getArtifactById(id))!;
    expect([saved.title, titleTag(saved.source)]).toEqual(['Draft: Q3 plan', 'Draft: Q3 plan']);

    // A rename is the person's name for it: the heading no longer renames it.
    const head = await (await read(request(`/api/artifacts/${id}`, { token }), params(id))).json();
    expect((await patch(request(`/api/artifacts/${id}`, { method: 'PATCH', token, json: { title: 'Board memo', expectedState: head.state } }), params(id))).status).toBe(200);
    await typeAtStart(live, owner, id, regionId, 'Final ');
    expect(await flush(live, owner, id)).toBe(4);
    saved = (await getArtifactById(id))!;
    expect(saved.title).toBe('Board memo');
    expect(titleTag(saved.source)).toBe('Draft: Q3 plan');
    expect(saved.source).toContain('Final Draft: Q3 plan');
  });

  it('a page that is not a doc keeps its own title when a region save changes its heading', async () => {
    const account = await mintAccountToken('plain-region');
    const html = '<!doctype html><html><head><title>Notes</title></head><body><article data-af-editable="rich"><h1>Notes</h1><p>x</p></article></body></html>';
    const created = await createBrowserArtifact(request('/api/my/artifacts', { method: 'POST', actor: { credential: 'session', userId: account.userId!, email: account.email!, emailVerified: true }, json: { html } }));
    const id = (await created.json()).id as string;
    const live = regionSessions();
    const owner = identityForUser(account.userId!, null) as AccessActor;
    await typeAtStart(live, owner, id, editableRegions((await getArtifactById(id))!.source!)[0]!.id, 'More ');
    expect(await flush(live, owner, id)).toBe(2);
    const saved = (await getArtifactById(id))!;
    expect(saved.meta.template).toBeUndefined();
    expect([saved.title, titleTag(saved.source)]).toEqual(['Notes', 'Notes']);
  });

  it('stays a doc through an agent\'s whole-page write, and the write may say it is not one', async () => {
    const account = await mintAccountToken('doc-agent');
    const actor = { credential: 'session' as const, userId: account.userId!, email: account.email!, emailVerified: true };
    const id = (await (await createBrowserArtifact(request('/api/my/artifacts', { method: 'POST', actor, json: artifactStarter('doc') }))).json()).id as string;
    const write = async (extra: Record<string, unknown>) => {
      const head = await (await read(request(`/api/artifacts/${id}`, { token: account.token }), params(id))).json();
      const html = head.html.replace('<p data-af-id', '<p>Written by an agent.</p><p data-af-id');
      const response = await replace(request(`/api/artifacts/${id}`, { method: 'PUT', token: account.token, json: { html, expectedVersion: head.version, expectedState: head.state, ...extra } }), params(id));
      expect(response.status).toBe(200);
      return (await getArtifactById(id))!;
    };
    expect((await write({})).meta.template).toBe('doc');
    expect((await write({ template: 'dashboard' })).meta.template).toBe('dashboard');
  });
});

describe('the agent handoff', () => {
  it('still starts from the placeholder page, with no doc mark and no editable region', async () => {
    const account = await mintAccountToken('handoff');
    const response = await startRoute(request('/api/start', { method: 'POST', token: account.token }));
    expect(response.status).toBe(201);
    const row = (await getArtifactById((await response.json()).id))!;
    expect(row.meta.startPlaceholder).toBe(true);
    expect(row.meta.template).toBeUndefined();
    expect(row.source).not.toContain('data-af-editable');
    expect(row.source).toMatch(/<main data-af-id="[^"]+"><h1 data-af-id="[^"]+">Untitled document<\/h1><\/main>/);
    expect(titleTag(row.source)).toBe('Untitled document');
  });
});
