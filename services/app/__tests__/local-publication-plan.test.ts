import { expect, it } from 'vitest';
import { POST } from '@/app/api/my/local-publications/plan/route';
import { request, useAppHarness, mintAccountToken } from './harness';
const harness = useAppHarness();
const body = { html: '<link rel="stylesheet" href="./styles/main.css"><img src="./images/logo.svg">', publicationBundle: { entryPath: 'index.html', files: [] as Array<{ path: string; contentType: string; base64: string }> } };
const file = (path: string, content: string, contentType: string) => ({ path, contentType, base64: Buffer.from(content).toString('base64') });
it('requires a real account and rejects missing local files without creating artifacts', async () => {
  expect((await POST(request('/api/my/local-publications/plan', { method: 'POST', json: body }))).status).toBe(401);
  const token = await mintAccountToken('local-plan');
  const actor = { credential: 'session' as const, userId: token.userId!, email: token.email!, emailVerified: true };
  const response = await POST(request('/api/my/local-publications/plan', { method: 'POST', actor, json: body }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: 'unresolved_publication_dependencies', details: [expect.stringContaining('images/logo.svg')] });
  expect((await (await harness.db()).query<{ n: number }>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(0);
});
it('previews the resolved nested dependency graph without creating files or pages', async () => {
  const token = await mintAccountToken('local-plan');
  const actor = { credential: 'session' as const, userId: token.userId!, email: token.email!, emailVerified: true };
  const response = await POST(request('/api/my/local-publications/plan', { method: 'POST', actor, json: { ...body, publicationBundle: { entryPath: 'index.html', files: [file('styles/main.css', 'body{background:url(../images/logo.svg)}', 'text/css'), file('images/logo.svg', '<svg/>', 'image/svg+xml')] } } }));
  expect(response.status).toBe(200);
  const plan = await response.json();
  expect(plan.dependencies.map((entry: { path: string }) => entry.path)).toEqual(['images/logo.svg', 'styles/main.css']);
  expect((await (await harness.db()).query<{ n: number }>('SELECT count(*)::int n FROM artifacts')).rows[0]?.n).toBe(0);
});
