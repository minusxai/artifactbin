/**
 * Live down-sync: the SSE surface at /a/<id>/events and the LISTEN fan-out
 * behind it. Asserts the properties the design rests on — first frame is
 * always current state (self-syncing), every accepted write wakes watchers,
 * anyone who may read the document may watch it, and subscriptions are
 * released. The id addressing the stream is the document's one identifier —
 * an address, not a credential.
 */
import { storedMarkup } from '@/test/helpers/echo';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';
import { MAX_LIVE_CHANNELS, liveChannelCount, resetLiveSubscriptions, subscribeToArtifact } from '@/lib/story/live';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret';
useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Wire { id: string; edit_id: string; markup: string | null; version: number }

async function setup(): Promise<{ token: string; doc: Wire }> {
  const mintRes = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 't' }, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }));
  const { token } = (await mintRes.json()) as { token: string };
  const sent = '<section><p>alpha text</p><p>beta text</p></section>';
  const res = await createArtifactRoute(
    request('/api/artifacts', { method: 'POST', token: token, json: { title: 'doc', markup: sent } }),
  );
  expect(res.status).toBe(201);
  const wire = (await res.json()) as Wire;
  return { token, doc: { ...wire, markup: storedMarkup(wire, sent) } };
}

/** Read SSE `data:` frames until `count` arrive (or the wait budget runs out). */
async function readFrames(body: ReadableStream<Uint8Array>, count: number, budgetMs = 3000): Promise<Record<string, unknown>[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: Record<string, unknown>[] = [];
  let buffer = '';
  const deadline = Date.now() + budgetMs;
  while (frames.length < count && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now())),
    ]);
    if (chunk.done || !chunk.value) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const line of buffer.split('\n\n')) {
      if (line.startsWith('data: ')) frames.push(JSON.parse(line.slice(6)));
    }
    buffer = '';
  }
  void reader.cancel().catch(() => {});
  return frames;
}

beforeEach(async () => {
  await resetLiveSubscriptions();
});

afterAll(async () => {
  await resetLiveSubscriptions();
});

describe('GET /a/<id>/events', () => {
  it('is an event-stream whose FIRST frame is the current document (self-syncing)', async () => {
    const { doc } = await setup();
    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    // A PING: the head's identity. The document itself comes from /events/frame
    // (live-frame.test.ts) — the stream carries nothing a relay must understand.
    const [first] = await readFrames(res.body!, 1);
    expect(first).toEqual({ editId: doc.edit_id, version: doc.version, by: null });
  });

  // The start-flow path: a watcher opens a THEMELESS placeholder, then the agent
  // publishes a themed document. Source alone is not enough — a frame that omits
  // the design lands the new content in the old (default) theme and color mode,
  // and the page the user was promised only appears if they reload.
  it('carries the DESIGN (theme, colorMode, template) in the FRAME, so a themed publish arrives themed', async () => {
    const { token, doc } = await setup();
    const before = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(before).toMatchObject({ theme: null, colorMode: null });
    const put = await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<div data-design="tw"><h1>themed</h1></div>', theme: 'terminal', colorMode: 'dark', template: 'deck' } }),
      params({ id: doc.id }),
    );
    expect(put.status).toBe(200);
    const after = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(after).toMatchObject({ theme: 'terminal', colorMode: 'dark', template: 'deck', version: 2 });
  });

  it('pings when an edit lands — the new head, by whom', async () => {
    const { token, doc } = await setup();
    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    const framesPromise = readFrames(res.body!, 2);

    const edit = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' } }),
      params({ id: doc.id }),
    );
    expect(edit.status).toBe(200);
    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[frames.length - 1]).toMatchObject({ version: 2 });
    expect((frames[frames.length - 1] as { editId: string }).editId).not.toBe(doc.edit_id);
    const frame = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(String(frame.source)).toContain('ALPHA');
  });

  it('pings for a whole-document replace too (PUT is not a side door)', async () => {
    const { token, doc } = await setup();
    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    const framesPromise = readFrames(res.body!, 2);
    const put = await putArtifact(request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<p>replaced</p>' } }), params({ id: doc.id }));
    expect(put.status).toBe(200);
    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[frames.length - 1]).toMatchObject({ version: 2 });
  });

  it('the frame carries dataset content inline; a document carries its source', async () => {
    const { token } = await setup();
    const make = async (body: Record<string, unknown>) => {
      const r = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
      expect(r.status).toBe(201);
      return (await r.json()) as Wire;
    };
    const ds = await make({ dataset: [{ m: 'Jan', v: 1 }] });
    const html = await make({ markup: '<p>hi</p>' });
    const dsFrame = await (await frameRoute(request(`/a/${ds.id}/events/frame`), params({ id: ds.id }))).json();
    expect(dsFrame).toMatchObject({ format: 'dataset', source: null });
    expect(JSON.parse(String(dsFrame.content))).toEqual([{ m: 'Jan', v: 1 }]);
    const htmlFrame = await (await frameRoute(request(`/a/${html.id}/events/frame`), params({ id: html.id }))).json();
    expect(htmlFrame).toMatchObject({ format: 'markup', content: null });
    expect(htmlFrame.source).toContain('hi');
    expect(htmlFrame.editId).toBe(html.edit_id);
  });

  it('the frame ALWAYS carries the stylesheet — it is stateless, so nothing is "omitted since last time"', async () => {
    const { token, doc } = await setup();
    const one = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(one).toHaveProperty('compiledCss');
    const edit = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' } }),
      params({ id: doc.id }),
    );
    expect(edit.status).toBe(200);
    const two = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(two).toHaveProperty('compiledCss');
    expect(two.compiledCss).toBe(one.compiledCss);
  });

  it('404s an unknown or malformed id, indistinguishably', async () => {
    // 'zzzzzz' is well-formed and names no row; the rest never pass ID_RE.
    for (const id of ['zzzzzz', 'nope', 'abc-12', 'NOT-A-SLUG!']) {
      const res = await eventsRoute(request(`/a/${id}/events`), params({ id }));
      expect(res.status).toBe(404);
    }
  });
});

describe('capacity', () => {
  it('refuses new channels past the cap with 503, and never blocks READING the page', async () => {
    const { doc } = await setup();
    // Fill the registry with distinct channels, then ask for one more.
    // channelFor lowercases, so the fillers are lowercase to begin with —
    // otherwise two ids differing only in case would collapse into one
    // channel and the cap would never be reached.
    const holders: Array<() => Promise<void>> = [];
    for (let i = 0; i < MAX_LIVE_CHANNELS; i++) {
      holders.push(await subscribeToArtifact(`filler${i}`, () => {}));
    }
    expect(liveChannelCount()).toBe(MAX_LIVE_CHANNELS);
    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');

    // The document itself is unaffected — live updates are an enhancement.
    const raw = await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }));
    expect(raw.status).toBe(200);

    for (const off of holders) await off();
    // Capacity is reclaimed once watchers leave.
    const after = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(after.status).toBe(200);
    void after.body?.cancel().catch(() => {});
  });
});

describe('subscription lifecycle', () => {
  it('shares one LISTEN across subscribers and releases it on the last unsubscribe', async () => {
    const { token, doc } = await setup();
    const seenA: string[] = [];
    const seenB: string[] = [];
    const offA = await subscribeToArtifact(doc.id, (id) => seenA.push(id));
    const offB = await subscribeToArtifact(doc.id, (id) => seenB.push(id));
    // Two watchers, ONE database LISTEN.
    expect(liveChannelCount()).toBe(1);

    const edit = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'A2' } }),
      params({ id: doc.id }),
    );
    const updated = (await edit.json()) as Wire;
    await new Promise((r) => setTimeout(r, 150));
    expect(seenA).toEqual([updated.edit_id]);
    expect(seenB).toEqual([updated.edit_id]);

    // After both leave, further writes reach nobody.
    await offA();
    expect(liveChannelCount()).toBe(1); // still one watcher left
    await offB();
    expect(liveChannelCount()).toBe(0); // the LISTEN itself is released, not just the handler
    await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: updated.edit_id, old_string: 'A2', new_string: 'A3' } }),
      params({ id: doc.id }),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
  });

  it('one subscriber throwing does not starve the others', async () => {
    const { token, doc } = await setup();
    const seen: string[] = [];
    const offBad = await subscribeToArtifact(doc.id, () => { throw new Error('boom'); });
    const offGood = await subscribeToArtifact(doc.id, (id) => seen.push(id));

    await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'B2' } }),
      params({ id: doc.id }),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toHaveLength(1);
    await offBad();
    await offGood();
  });
});
