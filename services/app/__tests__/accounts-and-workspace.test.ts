/**
 * gate-accounts-and-workspace's HTTP facts (scripts/gates/gate-accounts-and-workspace.mjs keeps the journeys a
 * browser must walk): `?intent=fork` is no lever for a stranger, who is served the ordinary app page around the
 * one document frame; and a folder's listing is in the FIRST HTML byte its viewer is sent, the whole shelf for its
 * owner and only the public children for a stranger.
 */
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it } from 'vitest';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser, mintToken } from '@/lib/accounts';
import { useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '../server/app';

useAppHarness();

const SECRET = 'vitest-actor-secret-0000000000000000';
const BASE = 'http://localhost:3000';
const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
const as = (actor: Actor) => ({ accept: 'text/html', [ACTOR_HEADER]: signActor(actor, SECRET) });
const STRANGER: Actor = { credential: 'none' };

async function world() {
  const user = await createUser({ email: 'mxmx_test_workspace_owner@example.com' });
  const t = await mintToken('owner');
  await claimToken(user.id, t.token);
  const publish = async (body: Record<string, unknown>) => {
    const res = await createRoute(new Request(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) }));
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: string };
  };
  const ownerActor: Actor = { credential: 'session', userId: user.id, email: user.email, emailVerified: true };
  return { publish, ownerActor };
}

describe('a shared link that carries ?intent=fork', () => {
  it('serves a stranger the ordinary app page: the document\'s title and its one frame, and no other iframe', async () => {
    const w = await world();
    const doc = await w.publish({ title: 'Fork gate', visibility: 'public', markup: '<div class="p-8"><h1>Fork gate</h1><p>The original.</p></div>' });
    const res = await app.request(`/a/${doc.id}?intent=fork`, { headers: as(STRANGER) });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Fork gate');
    expect(html).toContain('data-mx-document-frame');
    expect(html.match(/<iframe\b/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('<iframe title="artifact"');
  });
});

describe('a folder\'s page', () => {
  it('carries its listing in the first HTML byte: the whole shelf to its owner, the public children to a stranger', async () => {
    const w = await world();
    const folder = await w.publish({ format: 'folder', title: 'Field Notes', visibility: 'public' });
    await w.publish({ title: 'Opening Note', visibility: 'public', parent_id: folder.id, markup: '<div class="p-8"><h1>Opening Note</h1></div>' });
    await w.publish({ title: 'Quiet Note', parent_id: folder.id, markup: '<div class="p-8"><h1>Quiet Note</h1></div>' });

    const owned = await app.request(`/a/${folder.id}`, { headers: as(w.ownerActor) });
    expect(owned.status).toBe(200);
    const ownerHtml = await owned.text();
    expect(ownerHtml).toContain('Field Notes');
    expect(ownerHtml).toContain('Opening Note');
    expect(ownerHtml).toContain('Quiet Note');

    const seen = await app.request(`/a/${folder.id}`, { headers: as(STRANGER) });
    expect(seen.status).toBe(200);
    const strangerHtml = await seen.text();
    expect(strangerHtml).toContain('Opening Note');
    expect(strangerHtml).not.toContain('Quiet Note');
  });
});
