import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { getDb } from '@/lib/platform';
import { POST as create } from '@/app/api/artifacts/route';
import { backendSecrets, readPinnedBackendSecret } from '..';

useAppHarness();
async function fixture() {
  const owner = await mintAccountToken('pinned-secret-owner');
  const made = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: '<!doctype html><html><head></head><body><p>x</p></body></html>' } }));
  expect(made.status).toBe(201);
  const page = (await made.json() as { id: string }).id;
  const scope = { ownerId: owner.userId!, backendId: 'backend_1' };
  await backendSecrets.put(scope, 'API_TOKEN', 'sk-ünïcode-value');
  return { owner, page, scope, pinned: { ...scope, pageId: page, secretBindings: ['API_TOKEN'] } };
}

describe('readPinnedBackendSecret', () => {
  it('opens the declared secret for the owner of the live page it is pinned to', async () => {
    const { pinned } = await fixture();
    expect(await readPinnedBackendSecret(pinned, 'API_TOKEN')).toBe('sk-ünïcode-value');
  });

  it('refuses a name the backend did not declare, before reading anything', async () => {
    const { pinned } = await fixture();
    await expect(readPinnedBackendSecret({ ...pinned, secretBindings: [] }, 'API_TOKEN')).rejects.toThrow('backend_secret_forbidden');
    await expect(readPinnedBackendSecret({ ...pinned, secretBindings: undefined }, 'API_TOKEN')).rejects.toThrow('backend_secret_forbidden');
  });

  it('is unavailable once the page is deleted, moved to a group, owned by someone else, or the secret is missing', async () => {
    const db = await getDb();
    let f = await fixture();
    await expect(readPinnedBackendSecret({ ...f.pinned, secretBindings: ['API_TOKEN', 'OTHER'] }, 'OTHER')).rejects.toThrow('backend_secret_unavailable');
    await expect(readPinnedBackendSecret({ ...f.pinned, pageId: 'missing' }, 'API_TOKEN')).rejects.toThrow('backend_secret_unavailable');
    const stranger = await mintAccountToken('pinned-secret-stranger');
    await expect(readPinnedBackendSecret({ ...f.pinned, ownerId: stranger.userId! }, 'API_TOKEN')).rejects.toThrow('backend_secret_unavailable');
    await db.query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [f.page]);
    await expect(readPinnedBackendSecret(f.pinned, 'API_TOKEN')).rejects.toThrow('backend_secret_unavailable');
    f = await fixture();
    await db.query("INSERT INTO groups (id, handle, name, created_by) VALUES ('grp_secret', 'secret-group', 'Group', $1)", [f.owner.userId]);
    await db.query("UPDATE artifacts SET group_id = 'grp_secret' WHERE id = $1", [f.page]);
    await expect(readPinnedBackendSecret(f.pinned, 'API_TOKEN')).rejects.toThrow('backend_secret_unavailable');
  });

  it('is unavailable when the ciphertext is tampered with or bound to another backend', async () => {
    const { pinned } = await fixture();
    const db = await getDb();
    await db.query("UPDATE html_backend_secrets SET backend_id = 'backend_2'");
    await expect(readPinnedBackendSecret({ ...pinned, backendId: 'backend_2' }, 'API_TOKEN')).rejects.toThrow('backend_secret_unavailable');
    await db.query("UPDATE html_backend_secrets SET backend_id = 'backend_1', ciphertext = 'tampered'");
    await expect(readPinnedBackendSecret(pinned, 'API_TOKEN')).rejects.toThrow('backend_secret_unavailable');
  });
});
