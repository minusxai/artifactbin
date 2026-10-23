/** Native publication wakeups and retained annotation/subscription lifecycle. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { nativeHtml } from './native-html-fixture';
import { observedRequest } from './conditional-request';
import {
  useAppHarness,
  request,
  mintAccountToken as mintToken,
} from './harness';
import { readNamed, sseStream } from './sse';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { POST as actOnAnnotationRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import {
  GET as myListAnnotationsRoute,
  POST as myCreateAnnotationRoute,
} from '@/app/api/my/artifacts/[id]/annotations/route';
import { STORY_ANNOTATIONS_EVENT } from '@/lib/story-runtime/contract';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import {
  MAX_LIVE_CHANNELS,
  liveChannelCount,
  resetLiveSubscriptions,
  subscribeToArtifact,
} from '@/lib/publish/realtime/live';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({
  params: Promise.resolve(p),
});
interface Wire {
  id: string;
  edit_id: string;
  html: string;
  version: number;
}
async function setup() {
  const { token } = await mintToken('live-events');
  const response = await createArtifactRoute(
    request('/api/artifacts', {
      method: 'POST',
      token,
      json: {
        html: nativeHtml(
          '<section><p>alpha text</p><p>beta text</p></section>',
        ),
        visibility: 'public',
      },
    }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return { token, doc: (await response.json()) as Wire };
}
const replace = async (token: string, id: string, html: string) =>
  putArtifact(
    await observedRequest(`/api/artifacts/${id}`, {
      method: 'PUT',
      token,
      json: { html },
    }),
    params({ id }),
  );
beforeEach(resetLiveSubscriptions);
afterAll(resetLiveSubscriptions);
it('native publication delivers author CSS and dark appearance in the complete raw file', async () => {
  const { token, doc } = await setup();
  const source =
    '<!doctype html><html data-af-dark><head><style>h1{color:red}</style></head><body><h1>Themed</h1></body></html>';
  expect((await replace(token, doc.id, source)).status).toBe(200);
  const raw = await rawRoute(
    request(`/a/${doc.id}/raw`),
    params({ id: doc.id }),
  );
  expect(raw.status).toBe(200);
  const html = await raw.text();
  expect(html).toContain('data-af-dark');
  expect(html).toContain('h1{color:red}');
  expect(html).toContain('Themed');
});
it('every committed native whole-source replacement wakes readers with the new head', async () => {
  const { token, doc } = await setup(),
    response = await eventsRoute(
      request(`/a/${doc.id}/events`),
      params({ id: doc.id }),
    ),
    pending = readNamed(response.body!, 'message', 2);
  const changed = await replace(
    token,
    doc.id,
    doc.html.replace('alpha text', 'ALPHA'),
  );
  expect(changed.status).toBe(200);
  const frames = await pending;
  expect(frames).toHaveLength(2);
  expect(frames[1].data).toMatchObject({ version: 2 });
  expect(frames[1]!.data.editId).not.toBe(doc.edit_id);
  expect(
    await (
      await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))
    ).text(),
  ).toContain('ALPHA');
});
it('dataset live frames still carry preview data for the retained dataset viewer', async () => {
  const { token } = await setup();
  const made = await createArtifactRoute(
    request('/api/artifacts', {
      method: 'POST',
      token,
      json: { dataset: [{ m: 'Jan', v: 1 }], visibility: 'public' },
    }),
  );
  expect(made.status).toBe(201);
  const ds = await made.json();
  const frame = await (
    await frameRoute(request(`/a/${ds.id}/events/frame`), params({ id: ds.id }))
  ).json();
  expect(frame).toMatchObject({ format: 'dataset', source: null });
  expect(JSON.parse(frame.dataPreview)).toEqual([{ m: 'Jan', v: 1 }]);
});
it('unknown and malformed event IDs have the same not-found result', async () => {
  for (const id of ['zzzzzz', 'nope', 'abc-12', 'NOT-A-SLUG!'])
    expect(
      (await eventsRoute(request(`/a/${id}/events`), params({ id }))).status,
    ).toBe(404);
});
describe('capacity', () => {
  it('refuses new channels past the cap with 503, and never blocks READING the page', async () => {
    const { doc } = await setup();
    // Fill the registry with distinct channels, then ask for one more.
    // artifactChannel lowercases, so the fillers are lowercase to begin with —
    // otherwise two ids differing only in case would collapse into one
    // channel and the cap would never be reached.
    const holders: Array<() => Promise<void>> = [];
    for (let i = 0; i < MAX_LIVE_CHANNELS; i++) {
      holders.push(await subscribeToArtifact(`filler${i}`, () => {}));
    }
    expect(liveChannelCount()).toBe(MAX_LIVE_CHANNELS);
    const res = await eventsRoute(
      request(`/a/${doc.id}/events`),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');

    // The document itself is unaffected — live updates are an enhancement.
    const raw = await rawRoute(
      request(`/a/${doc.id}/raw`),
      params({ id: doc.id }),
    );
    expect(raw.status).toBe(200);

    for (const off of holders) await off();
    // Capacity is reclaimed once watchers leave.
    const after = await eventsRoute(
      request(`/a/${doc.id}/events`),
      params({ id: doc.id }),
    );
    expect(after.status).toBe(200);
    void after.body?.cancel().catch(() => {});
  });
});

describe('subscription lifecycle', () => {
  it('shares one LISTEN across subscribers and releases it on the last unsubscribe', async () => {
    const { token, doc } = await setup();
    const source = (text: string) =>
      nativeHtml(`<section><p>${text}</p><p>beta text</p></section>`);
    const seenA: string[] = [];
    const seenB: string[] = [];
    const offA = await subscribeToArtifact(doc.id, (id) => seenA.push(id));
    const offB = await subscribeToArtifact(doc.id, (id) => seenB.push(id));
    // Two watchers, ONE database LISTEN.
    expect(liveChannelCount()).toBe(1);

    const edit = await replace(token, doc.id, source('A2'));
    const updated = (await edit.json()) as Wire;
    await new Promise((r) => setTimeout(r, 150));
    expect(seenA).toEqual([updated.edit_id]);
    expect(seenB).toEqual([updated.edit_id]);

    // After both leave, further writes reach nobody.
    await offA();
    expect(liveChannelCount()).toBe(1); // still one watcher left
    await offB();
    expect(liveChannelCount()).toBe(0); // the LISTEN itself is released, not just the handler
    await replace(token, doc.id, source('A3'));
    await new Promise((r) => setTimeout(r, 150));
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
  });

  it('one subscriber throwing does not starve the others', async () => {
    const { token, doc } = await setup();
    const seen: string[] = [];
    const offBad = await subscribeToArtifact(doc.id, () => {
      throw new Error('boom');
    });
    const offGood = await subscribeToArtifact(doc.id, (id) => seen.push(id));

    await replace(token, doc.id, doc.html.replace('beta text', 'B2'));
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toHaveLength(1);
    await offBad();
    await offGood();
  });
});

/**
 * ANNOTATIONS ARE LIVE FOR ANNOTATORS. The events stream serves readers too,
 * and the named `annotations` frame is sent only on connections that can
 * annotate (owner, editor or commenter; a third subscription beside
 * the document and its datasets, on the annotations' own NOTIFY channel).
 * An owner connection gets one at CONNECT (self-syncing stream: the first
 * frame is current state) and one per change; an anonymous reader of the
 * same public document NEVER sees the event name at all.
 */
describe('GET /a/<id>/events — the annotations frame', () => {
  /** One persistent reader over the stream; `next(count)` may be called repeatedly. */

  async function annotationSetup() {
    const t = await mintToken('agent');
    const res = await createArtifactRoute(
      request('/api/artifacts', {
        method: 'POST',
        token: t.token,
        json: {
          html: nativeHtml(
            '<p>alpha</p><div data-af-id="figure">beta figure</div>',
          ),
          visibility: 'public',
        },
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = (await res.json()) as { id: string; edit_id: string };
    const actor = {
      userId: t.userId!,
      email: t.email!,
      emailVerified: true,
      credential: 'session' as const,
    };
    return { t, doc, actor };
  }

  const annotate = (
    id: string,
    actor: {
      userId: string;
      email: string;
      emailVerified: boolean;
      credential: 'session';
    },
    _editId: string,
  ) =>
    myCreateAnnotationRoute(
      request(`/api/my/artifacts/${id}/annotations`, {
        method: 'POST',
        actor,
        json: {
          anchor: {
            kind: 'html-node',
            v: 1,
            revision: '1',
            nodeId: 'figure',
            quote: '',
          },
          body: 'look here',
        },
      }),
      params({ id }),
    );

  it('an owner connection gets current annotations at connect, and a fresh frame on create and on resolve', async () => {
    const { t, doc, actor } = await annotationSetup();
    const first = (await (
      await annotate(doc.id, actor, doc.edit_id)
    ).json()) as { id: string };

    const res = await eventsRoute(
      request(`/a/${doc.id}/events`, { actor }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    const reader = sseStream(res.body!);

    // Frame 1 is the version ping (the stream is self-syncing); an annotations
    // PING follows. The list itself is fetched — the stream carries nothing a
    // blind relay would have to understand.
    const opening = await reader.named(STORY_ANNOTATIONS_EVENT);
    const connectFrame = opening.find(
      (e) => e.event === STORY_ANNOTATIONS_EVENT,
    );
    expect(
      connectFrame,
      JSON.stringify(opening.map((e) => e.event)),
    ).toBeTruthy();
    expect(connectFrame!.data).toEqual({});
    const list = async () =>
      (
        (await (
          await myListAnnotationsRoute(
            request(`/api/my/artifacts/${doc.id}/annotations?status=all`, {
              actor,
            }),
            params({ id: doc.id }),
          )
        ).json()) as { annotations: Array<{ id: string; status: string }> }
      ).annotations;
    expect((await list()).map((a) => a.id)).toEqual([first.id]);

    await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${first.id}`, {
        method: 'POST',
        token: t.token,
        json: { resolve: true },
      }),
      params({ id: doc.id, annId: first.id }),
    );
    const next = await reader.named(STORY_ANNOTATIONS_EVENT);
    expect(next[0].event).toBe(STORY_ANNOTATIONS_EVENT);
    expect((await list()).filter((a) => a.status === 'open')).toEqual([]);
    reader.close();
  });

  it('an anonymous reader of the same public document never sees the event', async () => {
    const { doc, actor } = await annotationSetup();
    const res = await eventsRoute(
      request(`/a/${doc.id}/events`),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    const reader = sseStream(res.body!);

    await annotate(doc.id, actor, doc.edit_id);
    // Give any (wrong) frame a moment to arrive; only the document frame may exist.
    const seen = await reader.next(3, 1200);
    expect(seen.some((e) => e.event === STORY_ANNOTATIONS_EVENT)).toBe(false);
    expect(seen.length).toBeGreaterThan(0); // the stream itself is alive (opening document frame)
    reader.close();
  });
});
