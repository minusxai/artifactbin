import {nativeHtml} from './native-html-fixture';
import {observedRequest} from '@/__tests__/conditional-request';
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
vi.mock('@/lib/authentication/request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authentication/request-identity')>();
  return {
    ...actual,
    sessionActor: async () => {
      const run = duringSetup;
      duringSetup = null;
      if (run) await run();
      return { userId: null, tokenId: null, email: null, documentEditor: false, emailVerified: null, credential: 'none' as const };
    },
  };
});

import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { resetLiveSubscriptions } from '@/lib/publish/realtime/live';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import { readNamed } from '@/__tests__/sse';

useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Read SSE `data:` frames until `count` arrive or the budget runs out. */

beforeEach(async () => {
  await resetLiveSubscriptions();
  duringSetup = null;
});

describe('a write that commits while the stream is opening', () => {
  it('is in the opening frame — the first frame is current state', async () => {
    const { token } = await mintAccountToken('stream-opening-race');
    const created = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'doc', html: nativeHtml('<p id="status">before</p>'), visibility: 'public' } }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const doc = (await created.json()) as { id: string };

    let newEditId = '';
    duringSetup = async () => {
      const put = await putArtifact(
        await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { html: nativeHtml('<p id="status">after</p>') } }),
        params({ id: doc.id }),
      );
      expect(put.status).toBe(200);
      newEditId = ((await put.json()) as { edit_id: string }).edit_id;
    };

    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(200);
    const frames = await readNamed(res.body!, 'message');

    expect(frames.length, 'the stream sent no frame at all').toBeGreaterThan(0);
    expect(
      frames[0].data.editId,
      `the opening frame is stale — the reader never learns about the write (got ${JSON.stringify(frames.map((f) => f.data.editId))}, current is ${newEditId})`,
    ).toBe(newEditId);
    // …and the frame that ping points at is the state after the write.
    const frame = await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }));
    expect(frame.status).toBe(200);expect(await frame.text()).toContain('>after</p>');
    await resetLiveSubscriptions();
  });
});
