/**
 * FACES ON THE READER RAIL, at the two doors that feed it: the served document
 * (/a/<id>/raw) draws the signed-in reader's face on its menu trigger and the
 * author's beside the handle, and the app's page data (/api/page/artifact/<id>)
 * hands the inline reader the author's id and picture to do the same.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { avatarUrl } from '@/lib/avatars';
import { getDb } from '@/lib/db';
import { personFaceBackground } from '@/lib/person-face';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, getUserById } from '@/lib/users';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };

beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });

const withPicture = async (userId: string, key: string) => {
  await (await getDb()).query('UPDATE users SET image_key = $2 WHERE id = $1', [userId, key]);
  return avatarUrl((await getUserById(userId))!)!;
};

async function world() {
  const author = await ensureUsername(await createUser({ email: 'mxmx_test_railauthor@example.com' }));
  const reader = await ensureUsername(await createUser({ email: 'mxmx_test_railreader@example.com' }));
  const authorImage = await withPicture(author.id, 'avatar/authorpic1');
  const readerImage = await withPicture(reader.id, 'avatar/readerpic1');
  const t = await mintToken('o'); await claimToken(author.id, t.token);
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'Faces', markup: '<div><p>hello</p></div>', visibility: 'public' } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const anonToken = await mintToken('anon');
  const anonRes = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: anonToken.token, json: { title: 'Nobody', markup: '<div><p>anon</p></div>', visibility: 'unlisted' } }));
  const anonId = ((await anonRes.json()) as { id: string }).id;
  return { author, reader, authorImage, readerImage, id, anonId };
}

const menuTrigger = (html: string): string =>
  html.match(/<button type="button" class="mx-reader-trigger" data-mx-reader-trigger="menu".*?<\/button>/)?.[0] ?? '';
const byline = (html: string): string => html.match(/<div class="mx-reader-byline".*?<\/div>/)?.[0] ?? '';

describe('the served document', () => {
  it("draws the signed-in reader's face on the menu trigger, and nobody's for a stranger", async () => {
    const w = await world();
    const stranger = await rawRoute(request(`/a/${w.id}/raw`), params({ id: w.id }));
    expect(stranger.headers.get('cache-control')).toBe('no-store');
    const strangerTrigger = menuTrigger(await stranger.text());
    expect(strangerTrigger).toContain('class="mx-rc-open"');
    expect(strangerTrigger).not.toContain('mx-reader-face');

    asSession(w.reader);
    const signedIn = await rawRoute(request(`/a/${w.id}/raw`), params({ id: w.id }));
    // Per-viewer bytes: never cached for the next reader.
    expect(signedIn.headers.get('cache-control')).toBe('no-store');
    const trigger = menuTrigger(await signedIn.text());
    expect(trigger).toContain('aria-label="Open menu"');
    expect(trigger).toContain(`style="background:${personFaceBackground(w.reader.id)}"`);
    expect(trigger).toContain(`>${w.reader.username![0]!.toUpperCase()}</span>`);
    expect(trigger).toContain(`<img src="${w.readerImage.replace(/&/g, '&amp;')}" alt="" aria-hidden="true"`);
  });

  it("puts the author's face in the handle's link, before the @, and none on an anonymous document or a capture", async () => {
    const w = await world();
    const html = await (await rawRoute(request(`/a/${w.id}/raw`), params({ id: w.id }))).text();
    const line = byline(html);
    expect(line).toContain(`style="background:${personFaceBackground(w.author.id)}"`);
    expect(line).toContain(`<img src="${w.authorImage}" alt="" aria-hidden="true"`);
    expect(line.indexOf('mx-reader-face')).toBeGreaterThan(line.indexOf('class="mx-reader-author"'));
    expect(line.indexOf('mx-reader-face')).toBeLessThan(line.indexOf(`@${w.author.username}</a>`));

    const anonymous = await (await rawRoute(request(`/a/${w.anonId}/raw`), params({ id: w.anonId }))).text();
    expect(byline(anonymous)).not.toContain('mx-reader-face');

    asSession(w.reader);
    const capture = await (await rawRoute(request(`/a/${w.id}/raw?chrome=0`), params({ id: w.id }))).text();
    expect(capture).not.toContain('data-mx-reader-chrome');
    expect(capture).not.toContain(w.readerImage);
  });
});

describe('GET /api/page/artifact/:id', () => {
  it("hands the inline reader the author's id and picture beside the handle", async () => {
    const w = await world();
    const body = await (await artifactPage(request(`/api/page/artifact/${w.id}`), params({ id: w.id }))).json();
    expect(body.surface.author).toMatchObject({ username: w.author.username, id: w.author.id, image: w.authorImage });
    expect(body.canonical).toBe(`/@${w.author.username}/${w.id}-faces`);
    const anonymous = await (await artifactPage(request(`/api/page/artifact/${w.anonId}`), params({ id: w.anonId }))).json();
    expect(anonymous.surface.author).toMatchObject({ username: null, id: null, image: null });
  });
});
