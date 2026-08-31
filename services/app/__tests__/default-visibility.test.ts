/**
 * Born visibility, per format: an image or dataset is an ASSET — a public
 * document reaches it at read time (`ref:` images are fetched by every
 * reader), so a born-private asset bakes a 404 into any shared document that
 * uses it. Account-owned assets are therefore born `unlisted` (readable by
 * link, listed nowhere), while documents (markup) and viz recipes stay born
 * `private` and anonymous creates stay born `public`. An explicit ask always
 * wins over every default.
 */
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';

import { getArtifactById } from '@/lib/artifacts';

import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const ROWS = [{ month: 'Jan', mrr: 100 }, { month: 'Feb', mrr: 140 }];

const RECIPE = {
  description: 'Simple bar',
  engine: 'vega-lite',
  bindings: [{ name: 'y', label: 'Y', accepts: ['quantitative'] }],
  template: { mark: 'bar', encoding: { y: { field: '{{y}}', type: 'quantitative' } } },
};

// A real 1×1 PNG, for the raw-body image door.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function create(token: string, body: Record<string, unknown>) {
  const res = await createArtifactRoute(new Request(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

async function createImage(token: string) {
  const res = await createArtifactRoute(new Request(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
    body: new Uint8Array(PNG_BYTES),
  }));
  return { status: res.status, body: await res.json() };
}

async function userToken(email: string) {
  const user = await createUser({ email });
  const t = await mintToken('t');
  await claimToken(user.id, t.token);
  return t.token;
}

describe('born visibility per format', () => {
  it('a user-owned dataset is born unlisted', async () => {
    const token = await userToken('dv-ds@example.com');
    const { status, body } = await create(token, { title: 'sales', dataset: ROWS });
    expect(status).toBe(201);
    expect(body.visibility).toBe('unlisted');
    expect((await getArtifactById(body.id))!.visibility).toBe('unlisted');
  });

  it('a user-owned image is born unlisted (raw-body upload)', async () => {
    const token = await userToken('dv-img@example.com');
    const { status, body } = await createImage(token);
    expect(status).toBe(201);
    expect(body.visibility).toBe('unlisted');
  });

  it('a user-owned document stays born private', async () => {
    const token = await userToken('dv-doc@example.com');
    const { body } = await create(token, { title: 'doc', markup: '<h1>hi</h1>' });
    expect(body.visibility).toBe('private');
  });

  it('a user-owned viz recipe stays born private', async () => {
    const token = await userToken('dv-viz@example.com');
    const { body } = await create(token, { title: 'bar', viz: RECIPE });
    expect(body.visibility).toBe('private');
  });

  it('an explicit ask beats the asset default', async () => {
    const token = await userToken('dv-explicit@example.com');
    const { body } = await create(token, { title: 'sales', dataset: ROWS, visibility: 'private' });
    expect(body.visibility).toBe('private');
  });

  it('anonymous creates stay born public, assets included', async () => {
    const t = await mintToken('anon');
    const ds = await create(t.token, { title: 'sales', dataset: ROWS });
    expect(ds.body.visibility).toBe('public');
    const img = await createImage(t.token);
    expect(img.body.visibility).toBe('public');
  });
});
