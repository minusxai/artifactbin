import { it, expect } from 'vitest';
import { nativeSource } from './native-publication-fixture';
import { request, useAppHarness } from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
useAppHarness();
/** Republishing the exact source the head already holds is a no-op: the head comes back, no version is added. */
it('creates no new version when the published source is identical to the head', async () => {
  const token = await mintToken('publish-unchanged');
  const html = nativeSource('<p>Same words</p>');
  const original = await (await create(request('/api/artifacts', { method: 'POST', token: token.token, json: { html } }))).json();
  const params = { params: Promise.resolve({ id: original.id }) }, path = `/api/artifacts/${original.id}`;
  const put = (body: Record<string, unknown>) => replace(request(path, { method: 'PUT', token: token.token, json: body }), params);
  const again = await put({ html, expectedVersion: original.version, expectedState: original.state });
  expect(again.status).toBe(200);
  const head = await again.json();
  expect(head.version).toBe(original.version);
  expect(head.edit_id).toBe(original.edit_id);
  // A real change still makes version 2, and republishing THAT is again a no-op.
  const changed = await (await put({ html: nativeSource('<p>Other words</p>'), expectedVersion: original.version, expectedState: original.state })).json();
  expect(changed.version).toBe(original.version + 1);
  const repeat = await (await put({ html: nativeSource('<p>Other words</p>'), expectedVersion: changed.version, expectedState: changed.state })).json();
  expect(repeat.version).toBe(changed.version);
  // A stale expectedVersion still conflicts: the no-op never hides a lost update.
  expect((await put({ html: nativeSource('<p>Other words</p>'), expectedVersion: original.version, expectedState: original.state })).status).toBe(409);
});
