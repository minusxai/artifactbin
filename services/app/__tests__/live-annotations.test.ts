/**
 * ANNOTATIONS ARE LIVE, FOR THE OWNER ONLY. The events stream serves readers
 * too, and annotations are owner-state — so the named `annotations` frame is
 * sent only on owner-credentialed connections (a third subscription beside
 * the document and its datasets, on the annotations' own NOTIFY channel).
 * An owner connection gets one at CONNECT (self-syncing stream: the first
 * frame is current state) and one per change; an anonymous reader of the
 * same public document NEVER sees the event name at all.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { POST as actOnAnnotationRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as myListAnnotationsRoute, POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { STORY_ANNOTATIONS_EVENT } from '@/lib/story-runtime/contract';


import { resetLiveSubscriptions } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface SseEvent { event: string; data: Record<string, unknown> }
/** One persistent reader over the stream; `next(count)` may be called repeatedly. */
function sseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (count: number, budgetMs = 3000): Promise<SseEvent[]> => {
    const out: SseEvent[] = [];
    const deadline = Date.now() + budgetMs;
    while (out.length < count && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now())),
      ]);
      if (chunk.done || !chunk.value) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) out.push({ event, data: JSON.parse(data) });
      }
    }
    return out;
  };
  return { next, close: () => void reader.cancel().catch(() => {}) };
}

async function setup() {
  const t = await mintToken('agent');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>alpha</p><div>beta figure</div>' } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const doc = (await res.json()) as { id: string; edit_id: string };
  const cookie = await agentCookie([t.id]);
  return { t, doc, cookie };
}

const annotate = (id: string, cookie: string, editId: string) =>
  myCreateAnnotationRoute(
    request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', cookie: cookie, json: { path: '1', edit_id: editId, body: 'look here' } }),
    params({ id }),
  );

beforeEach(async () => {
  await resetLiveSubscriptions();
});

describe('GET /a/<id>/events — the annotations frame', () => {
  it('an owner connection gets current annotations at connect, and a fresh frame on create and on resolve', async () => {
    const { t, doc, cookie } = await setup();
    const first = (await (await annotate(doc.id, cookie, doc.edit_id)).json()) as { id: string };

    const res = await eventsRoute(request(`/a/${doc.id}/events`, { cookie: cookie }), params({ id: doc.id }));
    expect(res.status).toBe(200);
    const reader = sseReader(res.body!);

    // Frame 1 is the version ping (the stream is self-syncing); an annotations
    // PING follows. The list itself is fetched — the stream carries nothing a
    // blind relay would have to understand.
    const opening = await reader.next(2);
    const connectFrame = opening.find((e) => e.event === STORY_ANNOTATIONS_EVENT);
    expect(connectFrame, JSON.stringify(opening.map((e) => e.event))).toBeTruthy();
    expect(connectFrame!.data).toEqual({});
    const list = async () => ((await (await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations?status=all`, { cookie: cookie }), params({ id: doc.id }))).json()) as { annotations: Array<{ id: string; status: string }> }).annotations;
    expect((await list()).map((a) => a.id)).toEqual([first.id]);

    await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${first.id}`, { method: 'POST', token: t.token, json: { resolve: true } }),
      params({ id: doc.id, annId: first.id }),
    );
    const next = await reader.next(1);
    expect(next[0].event).toBe(STORY_ANNOTATIONS_EVENT);
    expect((await list()).filter((a) => a.status === 'open')).toEqual([]);
    reader.close();
  });

  it('an anonymous reader of the same public document never sees the event', async () => {
    const { doc, cookie } = await setup();
    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(200);
    const reader = sseReader(res.body!);

    await annotate(doc.id, cookie, doc.edit_id);
    // Give any (wrong) frame a moment to arrive; only the document frame may exist.
    const seen = await reader.next(3, 1200);
    expect(seen.some((e) => e.event === STORY_ANNOTATIONS_EVENT)).toBe(false);
    expect(seen.length).toBeGreaterThan(0); // the stream itself is alive (opening document frame)
    reader.close();
  });
});
