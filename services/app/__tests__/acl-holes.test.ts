/**
 * Holes an adversarial review found in the ACL. Each of these passed the
 * whole suite while being wrong, so they are pinned here by the PROPERTY
 * that was violated, not by the shape of the fix:
 *
 *  1. The exporter's read key must not be a value the page already hands to
 *     readers. It was `edit_id` — printed in every viewer's HTML and only
 *     rotated on a WRITE, so one reader of a finished private document got a
 *     permanent, unrevocable public link to it.
 *  2. Revocation must reach an OPEN stream. The ACL ran once at connect, so a
 *     watcher who connected while a doc was public kept receiving everything
 *     written after it was locked, forever.
 *  3. The resolver must not answer "this id exists but is not yours"
 *     differently from "no such id".
 *  4. The wire must not carry the owner's internal account id.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactPage as ArtifactPage, profilePage as UserPage } from '@/test/helpers/pages';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintExportKey } from '@/lib/export-key';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, setUsername } from '@/lib/users';
import { resetLiveSubscriptions } from '@/lib/story/live';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const pageProps = (id: string, key?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(key ? { key } : {}),
});

async function outcome(p: Promise<unknown>): Promise<'render' | 'redirect' | 'notFound'> {
  try {
    // The pages answer as data now (test/helpers/pages): the outcome IS the value.
    const value = await p;
    if (value && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) return (value as { kind: 'render' | 'redirect' | 'notFound' }).kind;
    return 'render';
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) return 'redirect';
    if (digest.includes('NOT_FOUND') || digest.includes('404')) return 'notFound';
    throw error;
  }
}

async function fixtures() {
  const owner = await ensureUsername(await createUser({ email: 'hole@example.com' }));
  await setUsername(owner.id, 'holeowner');
  const t = await mintToken('hole');
  await claimToken(owner.id, t.token);
  return { owner, token: t.token };
}

const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string; edit_id: string }>;
};

async function readFrames(body: ReadableStream<Uint8Array>, count: number, budgetMs = 2500) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: Record<string, unknown>[] = [];
  let buffer = '';
  const deadline = Date.now() + budgetMs;
  while (frames.length < count && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
    ]);
    if (chunk.done || !chunk.value) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const line of buffer.split('\n\n')) if (line.startsWith('data: ')) frames.push(JSON.parse(line.slice(6)));
    buffer = '';
  }
  void reader.cancel().catch(() => {});
  return frames;
}

beforeEach(async () => {
  await resetLiveSubscriptions();
  sessionUser.id = '';
  sessionUser.email = '';
});

afterAll(async () => {
  await resetLiveSubscriptions();
});

describe('the exporter key is not a reader-visible value', () => {
  it('edit_id does NOT unlock a private document', async () => {
    const { token } = await fixtures();
    const doc = await create(token, { title: 'Secret', markup: '<h1>s</h1>' });
    // edit_id is handed to every viewer by the page; it must buy nothing.
    expect(await outcome(ArtifactPage(doc.id, { key: doc.edit_id }))).toBe('notFound');
  });

  it('a MINTED export key opens exactly one artifact, and only briefly', async () => {
    const { token } = await fixtures();
    const a = await create(token, { title: 'A', markup: '<section><p>a</p></section>' });
    const b = await create(token, { title: 'B', markup: '<section><p>b</p></section>' });

    expect(await outcome(ArtifactPage(a.id, { key: mintExportKey(a.id) }))).toBe('render');
    // Not transferable to another document…
    expect(await outcome(ArtifactPage(b.id, { key: mintExportKey(a.id) }))).toBe('notFound');
    // …not forgeable…
    expect(await outcome(ArtifactPage(a.id, { key: 'nonsense' }))).toBe('notFound');
    expect(await outcome(ArtifactPage(a.id, { key: `${Date.now() + 60_000}.deadbeef` }))).toBe('notFound');
    // …and not durable.
    expect(await outcome(ArtifactPage(a.id, { key: mintExportKey(a.id, -1) }))).toBe('notFound');
  });

  it('rejects malleable encodings of a real key', async () => {
    const { token } = await fixtures();
    const a = await create(token, { title: 'A', markup: '<section><p>a</p></section>' });
    const good = mintExportKey(a.id);
    const [exp, sig] = good.split('.');
    // Each of these normalizes to the same signed number, so a lax parser
    // would accept them; the key format is exact on purpose.
    for (const variant of [`${good}.junk`, ` ${good}`, `+${exp}.${sig}`, `0${exp}.${sig}`, `${exp}.${sig.toUpperCase()}`]) {
      expect(await outcome(ArtifactPage(a.id, { key: variant })), variant).toBe('notFound');
    }
  });

  it('an UNVERIFIED key buys nothing — not even the skipped canonical redirect', async () => {
    const { owner, token } = await fixtures();
    const doc = await create(token, { title: 'Public Doc', markup: '<h1>x</h1>', visibility: 'public' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    // A garbage key must leave the page canonicalizing exactly as it would
    // with no key at all, rather than pinning a second URL for the document.
    expect(await outcome(ArtifactPage(doc.id, { key: 'garbage' }))).toBe('redirect');
  });
});

describe('revocation reaches an open stream', () => {
  it('stops delivering once the document is locked mid-stream', async () => {
    const { token } = await fixtures();
    const doc = await create(token, {
      title: 'Open', markup: '<section><p>alpha text</p></section>', visibility: 'public',
    });

    // A stranger starts watching while it is public.
    const stream = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(stream.status).toBe(200);

    // The owner locks it, then writes something new.
    await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<section><p>alpha text</p></section>', visibility: 'private' } }),
      params({ id: doc.id }),
    );
    await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: { markup: '<section><p>TOPSECRET after revoke</p></section>' } }),
      params({ id: doc.id }),
    );

    const frames = await readFrames(stream.body!, 5);
    expect(frames.some((f) => String(f.source ?? '').includes('TOPSECRET'))).toBe(false);
  });
});

describe('the resolver is not an existence oracle', () => {
  it('answers the same for "someone else\'s private id" as for "no such id"', async () => {
    // A private document owned by a DIFFERENT account.
    const other = await createUser({ email: 'other@example.com' });
    const otherToken = await mintToken('other');
    await claimToken(other.id, otherToken.token);
    const secret = await create(otherToken.token, { title: 'Theirs', markup: '<h1>x</h1>' });

    const { owner } = await fixtures();
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;

    const real = await outcome(UserPage('@holeowner', [secret.id]));
    const fake = await outcome(UserPage('@holeowner', ['zzzzzz']));
    expect(real).toBe(fake);
  });
});

describe('the wire keeps internal ids internal', () => {
  it('never returns user_id', async () => {
    const { token } = await fixtures();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    const wire = await (await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: token }), params({ id: doc.id }))).json();
    expect('user_id' in wire).toBe(false);
    expect('token_id' in wire).toBe(false);
  });
});
