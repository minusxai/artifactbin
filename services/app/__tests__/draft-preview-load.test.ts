import { describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as saveEdits } from '@/app/api/artifacts/[id]/edits/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { POST as preview } from '@/app/a/[id]/draft-preview/route';
import { getArtifactById } from '@/lib/artifacts';
import { documentPublicationBody } from './prepared-document';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';

/** A CPU-bound compile on the request thread, as a heavy document's draft compile is: nothing else runs while it does. */
const COMPILE_MS = 120;
const spin = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const compiles = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/story/prepared/draft-preview.server', () => ({
  renderDraftPreview: async (input: { source: string }) => {
    compiles.count++;
    spin(COMPILE_MS);
    return `<!doctype html><p>${input.source.length}</p>`;
  },
}));
vi.mock('@/auth', () => ({ auth: async () => null }));
useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * A deployed request's database round trips: each is a turn of the event loop (PGLite here answers within
 * microtasks, which would hide the thread being held). A page load and a save make a few dozen.
 */
const roundTrips = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve)); };

describe('draft compiles under a burst of keystrokes', () => {
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
    const drafts = Array.from({ length: 100 }, (_, i) => sleep(i * 50).then(() => preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: {
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
