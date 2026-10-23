import {nativeHtml} from '@/__tests__/native-html-fixture';
import { beforeEach, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken } from '@/__tests__/harness';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { GET as headRead } from '@/app/api/my/artifacts/[id]/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { createUser, claimToken, ensureUsername } from '@/lib/accounts';

useAppHarness();
let account: { id: string; email: string } | null = null;
beforeEach(() => setSession(() => account ? { user: account } : null));
it('retires the browser editor door while preserving authorized API source readback', async () => {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_reader@example.com' }));
  account = { id: owner.id, email: owner.email! };
  const token = await mintAccountToken('reader', owner.id); await claimToken(owner.id, token.token);
  const made = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: { html:nativeHtml('<p id="body">Readable</p>'), visibility: 'public' } }));
  expect(made.status).toBe(201);
  const { id } = await made.json() as { id: string };
  const params = { params: Promise.resolve({ id }) };
  for (const suffix of ['?part=editor', '?part=editor&probe=1']) {
    expect((await artifactPage(request(`/api/page/artifact/${id}${suffix}`), params)).status).toBe(404);
  }
  const head = await headRead(request(`/api/my/artifacts/${id}`), params);
  expect(head.status).toBe(200);
  const wire = await head.json();
  expect(wire.html).toContain('Readable</p>');
  expect(wire.html).toContain('data-af-id=');
  const page = await artifactPage(request(`/api/page/artifact/${id}`), params);
  expect(page.status).toBe(200);
  expect((await page.json()).surface).not.toHaveProperty('sourceLength');
});
