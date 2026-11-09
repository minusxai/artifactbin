import {nativeHtml} from '@/__tests__/native-html-fixture';
/**
 * A TITLE-SLUG ADDRESS (lib/artifacts/slug-address): `/@handle/<title-slug>` serves the earliest page of that owner whose
 * title slugs to it, IN PLACE (no address healing), after the id grammar has had its say. A guessable title only finds a
 * page that is public, or one the viewer holds a role on without the link; anything else is the uniform 404.
 */
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as profileData } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { mintToken, createUser, ensureUsername } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const SECRET = 'vitest-actor-secret-0000000000000000';
const BASE = 'http://localhost:3000';
const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
const as = (actor: Actor) => ({ [ACTOR_HEADER]: signActor(actor, SECRET) });
const html = { accept: 'text/html' };
const payloadOf = (body: string) => JSON.parse(/<script type="application\/json" id="mx-page-data">([\s\S]*?)<\/script>/.exec(body)![1]!) as { path: string; address?: string; artifact?: unknown };

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_slug_owner@example.com' }));
  const t = await mintToken('o', owner.id);
  let minute = 0;
  const mk = async (title: string, visibility: string) => {
    const { id } = (await (await createArtifactRoute(new Request(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ title, html: nativeHtml(`<div><p>${title} words</p></div>`), visibility }) }))).json()) as { id: string };
    // Creation order made explicit: earliest first.
    await (await getDb()).query(`UPDATE artifacts SET created_at = now() - interval '1 day' + ($2 || ' minutes')::interval WHERE id = $1`, [id, String(minute++)]);
    return id;
  };
  const ownerHeaders = { ...html, ...as({ credential: 'session', userId: owner.id, email: owner.email }) };
  const stranger = { ...html, ...as({ credential: 'none' }) };
  return { owner, mk, ownerHeaders, stranger };
}

describe('a title-slug address', () => {
  it('serves the page in place, keeping the address, with the id URL as its canonical link', async () => {
    const w = await world();
    const id = await w.mk('Quarterly Report', 'public');
    for (let i = 0; i < 2; i++) { // twice: the anonymous shell cache answers the second
      const res = await app.request(`/@${w.owner.username}/quarterly-report`, { headers: w.stranger });
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
      const body = await res.text();
      expect(body).toContain('data-mx-document-frame');
      expect(body).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"/]+/@${w.owner.username}/${id}-quarterly-report">`));
      const payload = payloadOf(body);
      expect(payload.address).toBeUndefined();
      expect(payload.path).toBe(`/@${w.owner.username}/quarterly-report`);
      expect(JSON.stringify(payload.artifact)).toContain(id);
    }
    const api = await profileData(new Request(`${BASE}/api/page/profile/@${w.owner.username}/quarterly-report`), { params: Promise.resolve({ user: `@${w.owner.username}`, path: 'quarterly-report' }) });
    expect(await api.json()).toEqual({ kind: 'artifact', id });
  });

  it('takes the earliest page on a clash, and the next once that one is renamed away', async () => {
    const w = await world();
    const first = await w.mk('Notes', 'public');
    const second = await w.mk('Notes', 'public');
    const served = async () => JSON.stringify(payloadOf(await (await app.request(`/@${w.owner.username}/notes`, { headers: w.stranger })).text()).artifact);
    expect(await served()).toContain(first);
    await (await getDb()).query(`UPDATE artifacts SET title = 'Old notes' WHERE id = $1`, [first]);
    expect(await served()).toContain(second);
  });

  it('never finds an unlisted or private page for a stranger, but finds it for its owner', async () => {
    const w = await world();
    for (const [title, visibility] of [['Hidden Plan', 'unlisted'], ['Secret Plan', 'private']] as const) {
      const id = await w.mk(title, visibility);
      const path = `/@${w.owner.username}/${title.toLowerCase().replace(' ', '-')}`;
      const res = await app.request(path, { headers: w.stranger });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain(id);
      const own = await app.request(path, { headers: w.ownerHeaders });
      expect(own.status).toBe(200);
      expect(JSON.stringify(payloadOf(await own.text()).artifact)).toContain(id);
    }
  });

  it('lets the earliest page decide for everyone: a stranger gets the 404, never a later public twin', async () => {
    const w = await world();
    const hidden = await w.mk('Roadmap', 'unlisted');
    await w.mk('Roadmap', 'public');
    expect((await app.request(`/@${w.owner.username}/roadmap`, { headers: w.stranger })).status).toBe(404);
    expect(JSON.stringify(payloadOf(await (await app.request(`/@${w.owner.username}/Roadmap`, { headers: w.ownerHeaders })).text()).artifact)).toContain(hidden);
  });

  it('lets a real id win, and answers 404 when nothing slugs to the address', async () => {
    const w = await world();
    const id = await w.mk('Some Page', 'public');
    const byId = await app.request(`/@${w.owner.username}/${id}`, { headers: w.stranger });
    expect(payloadOf(await byId.text()).address).toBe(`/@${w.owner.username}/${id}-some-page`);
    expect((await app.request(`/@${w.owner.username}/no-such-page`, { headers: w.stranger })).status).toBe(404);
    expect((await app.request(`/@nobody_here/some-page`, { headers: w.stranger })).status).toBe(404);
  });
});
