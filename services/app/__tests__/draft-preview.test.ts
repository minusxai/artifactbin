import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, setSession } from '@/__tests__/harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as saveEdits } from '@/app/api/artifacts/[id]/edits/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { GET as editSheet, POST as preview } from '@/app/a/[id]/draft-preview/route';
import { getArtifactById } from '@/lib/artifacts';
import { documentPublicationBody } from './prepared-document';
import { mintToken } from '@/lib/accounts';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';

/** A CPU-bound compile on the request thread, as a heavy document's draft compile is: nothing else runs while it does. */
const COMPILE_MS = 120;
const spin = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// The draft compile stands in for a heavy one only in the burst test below (merged from draft-preview-load.test.ts);
// every other test here renders through the real one.
const compiles = vi.hoisted(() => ({ count: 0, heavy: false }));
vi.mock('@/lib/story/prepared/draft-preview.server', async (original) => {
  const actual = await original<typeof import('@/lib/story/prepared/draft-preview.server')>();
  return {
    ...actual,
    renderDraftPreview: async (input: Parameters<typeof actual.renderDraftPreview>[0]) => {
      if (!compiles.heavy) return actual.renderDraftPreview(input);
      compiles.count++;
      spin(COMPILE_MS);
      return `<!doctype html><p>${input.source.length}</p>`;
    },
  };
});

useAppHarness();
beforeEach(() => setSession(null));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('the editor draft preview door', () => {
  it('resolves a newly uploaded image before the draft has been saved', async () => {
    const { token } = await mintToken('draft-preview-image');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_image_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const image = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    } }));
    expect(image.status).toBe(201);
    const imageId = ((await image.json()) as { id: string }).id;
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Draft', markup: '<div><p>Before</p></div>', visibility: 'private',
    } }));
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: {
      editId: row.edit_id, source: `<div><p>Before</p><img src="ref:${imageId}" /></div>`,
    } }), params(id));
    expect(answer.status).toBe(200);
    const document = new JSDOM(((await answer.json()) as { html: string }).html).window.document;
    expect(document.querySelector('img')?.getAttribute('src')).toContain(`/a/${imageId}/raw`);
    expect((await getArtifactById(id))?.source).not.toContain(imageId);
  });
  it("answers an editor the whole sheet a draft of the head compiles with, and nobody else", async () => {
    const { token } = await mintToken('draft-preview-sheet');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_sheet_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const source = '<div><p class="text-lg">Before</p></div>';
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: { title: 'Draft', markup: source, visibility: 'private' } }));
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const answer = await editSheet(request(`/a/${id}/draft-preview`, { token }), params(id));
    expect(answer.status).toBe(200);
    const { css } = (await answer.json()) as { css: string };
    const draft = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: { editId: row.edit_id, source } }), params(id));
    const drafted = new JSDOM(((await draft.json()) as { html: string }).html).window.document.querySelector('style[data-mx-story-css]')?.textContent;
    // The first compile reply of an unchanged draft finds this sheet already in place: nothing to swap.
    expect(css).toBe(drafted);
    const stranger = await mintToken('draft-preview-sheet-stranger');
    expect((await editSheet(request(`/a/${id}/draft-preview`, { token: stranger.token }), params(id))).status).toBe(404);
  });
  it('renders a query document through its matching server island build', async () => {
    const { token } = await mintToken('draft-preview-query');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_query_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const dataset = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Rows', dataset: [{ label: 'first', value: 42 }],
    } }));
    expect(dataset.status).toBe(201);
    const datasetId = ((await dataset.json()) as { id: string }).id;
    const source = `<Helmet><Import name="rows_data" src="ref:${datasetId}" /><Query name="rows">` + '{`select * from rows_data.rows`}' + '</Query></Helmet><div><p>Before</p><Question data="$rows" /></div>';
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: { title: 'Draft', markup: source, visibility: 'private' } }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: {
      editId: row.edit_id, source: source.replace('Before', 'After'),
    } }), params(id));
    expect(answer.status).toBe(200);
    const document = new JSDOM(((await answer.json()) as { html: string }).html).window.document;
    expect(document.querySelector('p')?.textContent).toBe('After');
  });
  it("renders bound text at the editor's current values, as the running store holds them", async () => {
    const { token } = await mintToken('draft-preview-values');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_values_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const source = '<Helmet><Value name="fruit" type="string" default="apple" /></Helmet><div><p id="chosen">Chosen fruit: {$fruit}</p><Select label="Fruit" value="$fruit" options={["apple","banana"]} /></div>';
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: { title: 'Draft', markup: source, visibility: 'private' } }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const draft = source.replace('<div>', '<div><p>Typed</p>');
    const at = async (search?: string) => {
      const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: { editId: row.edit_id, source: draft, ...(search !== undefined ? { search } : {}) } }), params(id));
      expect(answer.status).toBe(200);
      return new JSDOM(((await answer.json()) as { html: string }).html).window.document.querySelector('#chosen')?.textContent;
    };
    expect(await at()).toBe('Chosen fruit: apple');
    expect(await at('?$fruit=banana')).toBe('Chosen fruit: banana');
  });
  it('compiles an admitted unsaved draft without changing the published source', async () => {
    const { token } = await mintToken('draft-preview');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Draft', markup: '<div id="root"><p id="copy">Published</p></div>', visibility: 'private',
    } }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const body = { editId: row.edit_id, source: '<div id="root"><p id="copy">Unsaved</p></div>' };
    const guest = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', json: body }), params(id));
    expect(guest.status).toBe(404);
    // A save can land between the editor's draft and its preview: the draft still renders.
    const stale = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: { ...body, editId: 'stale' } }), params(id));
    expect(stale.status).toBe(200);
    const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: body }), params(id));
    expect(answer.status).toBe(200);
    const document = new JSDOM(((await answer.json()) as { html: string }).html).window.document;
    expect(document.querySelector('#copy')?.textContent).toBe('Unsaved');
    expect(document.querySelector('#copy')?.getAttribute('data-mx-ast')).toBe('0.0');
    expect((await getArtifactById(id))?.source).toContain('Published');
  });
});

// Merged from draft-preview-load.test.ts.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * A deployed request's database round trips: each is a turn of the event loop (PGLite here answers within
 * microtasks, which would hide the thread being held). A page load and a save make a few dozen.
 */
const roundTrips = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve)); };

describe('draft compiles under a burst of keystrokes', () => {
  beforeEach(() => { compiles.heavy = true; });
  afterEach(() => { compiles.heavy = false; });
  it('keeps pages and the owner save answering while one session sends 100 drafts in 5 s', async () => {
    const { token } = await mintToken('draft-preview-load');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_load_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Heavy', markup: '<div id="root"><p id="copy">Published</p></div>', visibility: 'unlisted',
    } }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;

    // The reader's page is warm before the burst (its first load imports the page code): latency under load is measured, not a cold start.
    expect((await pageData(request(`/api/page/artifact/${id}`), params(id))).status).toBe(200);

    // The editor: one draft every 50 ms for 5 s, sent on its own clock (no debounce, no in-flight limit): a
    // compile that holds the thread delays the drafts behind it, which then arrive together.
    const drafts = Array.from({ length: 100 }, (_, i) => sleep(i * 50).then(() => preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, headers: { 'x-draft-sequence': `editor-1.${i}` }, json: {
      editId: row.edit_id, source: `<div id="root"><p id="copy">Draft ${'x'.repeat(i)}</p></div>`,
    } }), params(id))).then((answer) => answer.status));
    const typing = Promise.all(drafts);

    // A second reader loads the page throughout; the owner saves mid-burst.
    const pageTimes: number[] = [];
    const reading = (async () => {
      await sleep(250);
      for (let i = 0; i < 8; i++) {
        const started = performance.now();
        await roundTrips();
        const page = await pageData(request(`/api/page/artifact/${id}`), params(id));
        pageTimes.push(performance.now() - started);
        expect(page.status).toBe(200);
        await sleep(400);
      }
    })();
    await sleep(2_500);
    const saveStarted = performance.now();
    await roundTrips();
    const saved = await saveEdits(request(`/api/artifacts/${id}/edits`, { method: 'POST', token,
      json: documentPublicationBody(row, { source: '<div id="root"><p id="copy">Saved while typing</p></div>' }) }), params(id));
    const saveMs = performance.now() - saveStarted;

    await Promise.all([typing, reading]);
    const statuses = await Promise.all(drafts);
    const report = { saveMs: Math.round(saveMs), pageMs: pageTimes.map(Math.round), compiles: compiles.count, statuses: Object.fromEntries([200, 409, 429].map((s) => [s, statuses.filter((x) => x === s).length])) };
    console.log('draft burst', JSON.stringify(report));
    expect(saved.status, await saved.clone().text()).toBeLessThan(300);
    expect(saveMs).toBeLessThan(1_000);
    expect(Math.max(...pageTimes)).toBeLessThan(1_000);
    // Superseded drafts are answered at once rather than compiled; the newest draft still compiles.
    expect(statuses.at(-1)).toBe(200);
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThan(50);
    expect(statuses.every((s) => s === 200 || s === 409 || s === 429)).toBe(true);
    expect(compiles.count).toBeLessThan(50);
  }, 30_000);
});
