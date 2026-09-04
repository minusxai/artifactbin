/**
 * Route params arrive PERCENT-ENCODED from the Next router — '@' is '%40' —
 * while a direct call in a test passes them decoded. That difference shipped
 * a real bug: every pretty URL 404'd on the running server while every unit
 * test passed, because the tests were the only caller handing over a decoded
 * '@'. These cases feed the ENCODED forms the router actually produces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';

import { artifactMetadata, profilePage as UserPage } from '@/test/helpers/pages';

import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, setUsername } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

const props = (user: string, path?: string[]) => ({ params: Promise.resolve({ user, path }) });

async function outcome(p: Promise<unknown>): Promise<{ kind: 'render' | 'redirect' | 'notFound'; to?: string }> {
  try {
    // The pages answer as data now (test/helpers/pages): the outcome IS the value.
    const value = await p;
    if (value && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) return value as { kind: 'render' | 'redirect' | 'notFound'; to?: string };
    return { kind: 'render' };
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) return { kind: 'redirect', to: digest.split(';')[2] };
    if (digest.includes('NOT_FOUND') || digest.includes('404')) return { kind: 'notFound' };
    throw error;
  }
}

async function fixtures() {
  const owner = await ensureUsername(await createUser({ email: 'enc@example.com' }));
  await setUsername(owner.id, 'mxmx_owner');
  const t = await mintToken('enc');
  await claimToken(owner.id, t.token);
  const res = await createArtifactRoute(
    new Request(`${BASE}/api/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
      body: JSON.stringify({ title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public' }),
    }),
  );
  expect(res.status).toBe(201);
  const doc = (await res.json()) as { id: string };
  return { owner, doc };
}

beforeEach(async () => {
  sessionUser.id = '';
  sessionUser.email = '';
});

describe('percent-encoded route params (what the router really sends)', () => {
  it('resolves %40username exactly like @username', async () => {
    const { doc } = await fixtures();
    const canonical = `/@mxmx_owner/${doc.id}-eating-healthy`;
    // Already canonical apart from the encoding → renders, no redirect loop.
    expect((await outcome(UserPage('%40mxmx_owner', [`${doc.id}-eating-healthy`]))).kind).toBe('render');
    // An OLD link still carrying folder segments heals: resolution is by id,
    // and everything before the last segment was always decoration.
    expect(await outcome(UserPage('%40mxmx_owner', ['2026', '08', `${doc.id}-eating-healthy`]))).toEqual({ kind: 'redirect', to: canonical });
    // Non-canonical + encoded → still heals.
    expect(await outcome(UserPage('%40wronguser', [`${doc.id}`]))).toEqual({ kind: 'redirect', to: canonical });
  });

  it('decodes encoded PATH segments too, so a title slug with encoding still resolves', async () => {
    const { doc } = await fixtures();
    // '%2D' is '-', the id/slug delimiter: an encoded delimiter must not hide
    // the id. Decoded it IS the canonical address, so it renders in place.
    expect((await outcome(UserPage('%40mxmx_owner', [`${doc.id}%2Deating%2Dhealthy`]))).kind).toBe('render');
    // An encoded segment that decodes to a STALE slug still heals by id.
    expect(await outcome(UserPage('%40mxmx_owner', [`${doc.id}%2Dstale%2Dtitle`]))).toEqual({
      kind: 'redirect',
      to: `/@mxmx_owner/${doc.id}-eating-healthy`,
    });
  });

  it('generateMetadata resolves the encoded form as well', async () => {
    const { doc } = await fixtures();
    const meta = await artifactMetadata(doc.id);
    expect(meta.title).toBe('Eating Healthy');
  });

  it('a malformed percent-escape is a 404, never a crash', async () => {
    await fixtures();
    expect((await outcome(UserPage('%E0%A4%A', ['x']))).kind).toBe('notFound');
  });

  it('username matching is case-insensitive in the URL', async () => {
    const { doc } = await fixtures();
    expect(await outcome(UserPage('@PPSreejith', [doc.id]))).toEqual({
      kind: 'redirect',
      to: `/@mxmx_owner/${doc.id}-eating-healthy`,
    });
  });
});
