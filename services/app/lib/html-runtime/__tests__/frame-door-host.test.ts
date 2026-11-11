/**
 * A HOST PAGE ON ANOTHER ORIGIN IS REFUSED BY THE DOCUMENT ITSELF: a document served through the real app server carries
 * the one parent origin it trusts (the app's, `config.appOrigin`), and the door it opens (../frame-door) starts a bridge
 * session only for an attach from its parent on exactly that origin. The document host module
 * (lib/html-reader/host-shell) refuses to mount elsewhere as well (lib/html-reader/__tests__/host-shell.test.ts).
 */
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { expect, it } from 'vitest';
import { STORY_FRAME_BRIDGE_MESSAGE } from '@/lib/html-reader/contract';
import { framedDocumentSrc } from '@/lib/document-serving';
import { createArtifactFromBody } from '@/lib/publish';
import { identityForUser } from '@/lib/accounts';
import { setServices } from '@/lib/platform';
import { createAppServer } from '@/server/app';
import { mintAccountToken, testPagesSite, useAppHarness } from '@/__tests__/harness';
import { openFrameDoor } from '../frame-door';

useAppHarness();
const APP = 'https://app.example.test';
const site = testPagesSite('pages.example.test', APP);

it('opens a bridge session only for its parent on the app origin it was served with', async () => {
  const owner = await mintAccountToken('door_owner');
  const created = await createArtifactFromBody({ visibility: 'private', html: '<html><body><h1>Plan</h1></body></html>' }, identityForUser(owner.userId, owner.id, owner.email), APP);
  const { id } = await created.json() as { id: string };
  setServices({ humanSessions: { live: async (ref) => ref === 'door-session' } });
  const reader: Actor = { credential: 'session', sessionId: 'door-session', userId: owner.userId!, email: owner.email ?? '', emailVerified: true };
  const fresh = await framedDocumentSrc(attachActor(new Request(`${APP}/api/page/frame/${id}`), reader), id, site);
  expect(fresh?.appOrigin).toBe(APP);
  const app = createAppServer({ indexHtml: async () => '<html><body></body></html>', pagesSite: site });
  const served = await (await app.request(fresh!.src, { headers: { accept: 'text/html' } })).text();
  const config = JSON.parse(/<script[^>]*data-af="runtime"[^>]*>([\s\S]*?)<\/script>/.exec(served)![1]!) as { appOrigin: string };
  expect(config.appOrigin).toBe(APP);

  // The door reads MessageEvent's own getters (captured before an author script can replace them), as a browser has them.
  class FakeEvent { stopImmediatePropagation() {} }
  class FakeMessageEvent extends FakeEvent {
    readonly isTrusted = true;
    constructor(private readonly init: { data: unknown; origin: string; source: unknown }) { super(); }
    get data() { return this.init.data; }
    get origin() { return this.init.origin; }
    get source() { return this.init.source; }
  }
  const listeners: Array<(event: unknown) => void> = [];
  const parent = { postMessage() {} };
  const frame = { parent, MessageEvent: FakeMessageEvent, Event: FakeEvent, addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.push(listener), removeEventListener() {} };
  let started = 0;
  const close = openFrameDoor(frame as unknown as Window, config.appOrigin, async () => { started++; return { startFrameBridge: () => ({ receive() {}, dispose() {} }) }; });
  const attach = { type: STORY_FRAME_BRIDGE_MESSAGE, key: 'k'.repeat(24), payload: { kind: 'attach', id, editId: '', source: null } };
  const from = (origin: string) => { for (const listener of listeners) listener(new FakeMessageEvent({ data: attach, origin, source: parent })); };
  from('https://shell.other.test');
  from(fresh!.origin);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toBe(0);
  from(APP);
  await expect.poll(() => started).toBe(1);
  close();
});
