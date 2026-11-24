import { expect, it } from 'vitest';
import { GET } from '@/app/api/page/home/route';
import { createUser } from '@/lib/accounts';
import { link, unlink } from '@/lib/social';
import { mintAccountToken, request, useAppHarness } from './harness';
import { dropShares, seedArtifacts, seedShares, setArtifact } from './rows';

const harness = useAppHarness();

it('lists only my live readable liked pages across owners in last-liked order', async () => {
  const db = await harness.db();
  const reader = await createUser({ email: 'mxmx_test_reader@example.com' });
  const owner = await createUser({ email: 'mxmx_test_writer@example.com' });
  const token = await mintAccountToken('writer', owner.id);
  for (const [id, visibility] of [['public1','public'], ['shared1','private'], ['link01','unlisted'], ['other1','public']]) {
    await seedArtifacts(db, { id, user_id: owner.id, token_id: token.id, format: 'html', visibility, meta: '{}', version: 1 });
  }
  await seedShares(db, { artifact_id: 'shared1', user_id: reader.id, email: reader.email, role: 'viewer' });
  const actor = { credential: 'session' as const, userId: reader.id, email: reader.email!, emailVerified: true };
  const listed = async () => {
    const response = await GET(request('/api/page/home?part=liked', { actor }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    return (await response.json()).artifacts.map((row: {id:string}) => row.id);
  };
  for (const id of ['public1','shared1','link01']) await link(reader.id, 'like', id);
  await link(owner.id, 'like', 'other1');
  expect(await listed()).toEqual(['link01','shared1','public1']);
  await unlink(reader.id, 'like', 'public1');
  await link(reader.id, 'like', 'public1');
  expect(await listed()).toEqual(['public1','link01','shared1']);
  await dropShares(db, 'shared1');
  await setArtifact(db, 'link01', { deleted_at: { sql: 'now()' } });
  expect(await listed()).toEqual(['public1']);
  await unlink(reader.id, 'like', 'public1');
  expect(await listed()).toEqual([]);
});
