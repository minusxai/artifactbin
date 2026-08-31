/**
 * The opening frame must be a read taken AFTER the subscription exists.
 *
 * The stream's whole self-syncing contract rests on it ("NOTIFY is only a
 * wakeup, every wakeup does a catch-up read, and the first frame is always
 * current state — so a missed notification costs nothing"). It was not true:
 * the opening frame was built from the row read at the TOP of the handler,
 * before the session lookup, the ACL query and the LISTEN. A write committing
 * in that window was lost twice over — absent from the frame (the row predates
 * it) and unheard (nobody was listening yet) — and the reader then sat on a
 * stale document until it reloaded, with no further wakeup to rescue it.
 *
 * Found by gate-simpler-start, which claims a token and edits within a few ms
 * of the human's page connecting: it failed roughly one run in three.
 *
 * The window is forced deterministically here by committing the write inside
 * `sessionActor` — the viewer resolution the handler awaits between the two
 * points.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Runs inside the handler, between its first read and its subscription. */
let duringSetup: (() => Promise<void>) | null = null;
vi.mock('@/lib/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/viewer')>();
  return {
    ...actual,
    sessionActor: async () => {
      const run = duringSetup;
      duringSetup = null;
      if (run) await run();
      return { viewer: null, tokenId: null };
    },
  };
});

import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';


import { resetLiveSubscriptions } from '@/lib/story/live';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Read SSE `data:` frames until `count` arrive or the budget runs out. */
async function readFrames(body: ReadableStream<Uint8Array>, count: number, budgetMs = 2500): Promise<Record<string, unknown>[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: Record<string, unknown>[] = [];
  let buffer = '';
  const deadline = Date.now() + budgetMs;
  while (frames.length < count && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(0, deadline - Date.now()))),
    ]);
    if (chunk.done || !chunk.value) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const line of buffer.split('\n\n')) {
      const m = /^data: (.*)$/m.exec(line);
      if (m) { try { frames.push(JSON.parse(m[1])); } catch { /* keepalive */ } }
    }
    buffer = '';
  }
  void reader.cancel().catch(() => {});
  return frames;
}

beforeEach(async () => {
  await resetLiveSubscriptions();
  duringSetup = null;
});

describe('a write that commits while the stream is opening', () => {
  it('is in the opening frame — the first frame is current state', async () => {
    const mint = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 't' }, headers: { 'x-shared-secret': 'test-secret' } }));
    const { token } = (await mint.json()) as { token: string };
    const created = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'doc', markup: '<p>before</p>' } }),
    );
    const doc = (await created.json()) as { id: string };

    let newEditId = '';
    duringSetup = async () => {
      const put = await putArtifact(
        request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<p>after</p>' } }),
        params({ id: doc.id }),
      );
      expect(put.status).toBe(200);
      newEditId = ((await put.json()) as { edit_id: string }).edit_id;
    };

    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(200);
    const frames = await readFrames(res.body!, 1);

    expect(frames.length, 'the stream sent no frame at all').toBeGreaterThan(0);
    expect(
      frames[0].editId,
      `the opening frame is stale — the reader never learns about the write (got ${JSON.stringify(frames.map((f) => f.editId))}, current is ${newEditId})`,
    ).toBe(newEditId);
    // …and the frame that ping points at is the state after the write.
    const frame = await (await frameRoute(request(`/a/${doc.id}/events/frame`), params({ id: doc.id }))).json();
    expect(frame.source).toBe('<p>after</p>');
    await resetLiveSubscriptions();
  });
});
