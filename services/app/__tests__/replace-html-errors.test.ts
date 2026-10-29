import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { useAppHarness, mintAccountToken, request } from '@/__tests__/harness';
import { artifactState, createArtifact, getArtifactById } from '@/lib/artifacts';
import { claimToken } from '@/lib/authentication';
import { createUser } from '@/lib/accounts';
import * as artifactRoute from '@/app/api/artifacts/[id]/route';
import { mountRoutes } from '@/server/api';

/** Saving a page answers invalid HTML by name; a database failure on the way is logged and answered with a fixed 500. */
const harness = useAppHarness();
const app = new Hono();
mountRoutes(app, [{ path: '/api/artifacts/:id', dir: '/api/artifacts/[id]', methods: ['PUT'], module: artifactRoute }] as unknown as Parameters<typeof mountRoutes>[1]);

afterEach(() => vi.restoreAllMocks());

async function page(body: string) {
  const user = await createUser({ email: `replace-${crypto.randomUUID()}@example.com` });
  const token = await mintAccountToken('replace', user.id);
  await claimToken(user.id, token.token);
  const row = await createArtifact(token.id, user.id, { format: 'html', source: nativeHtml(body), meta: {}, visibility: 'private' });
  return { id: row.id, token: token.token };
}
async function put(doc: { id: string; token: string }, body: string) {
  const row = (await getArtifactById(doc.id))!;
  return app.fetch(request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: doc.token, json: { html: nativeHtml(body), expectedVersion: row.version, expectedState: artifactState(row) } }));
}

it('keeps the detailed message for HTML the store refuses', async () => {
  const doc = await page('<p data-af-id="kept">A</p><p data-af-id="gone">B</p>');
  expect((await put(doc, '<p data-af-id="kept">A</p>')).status).toBe(200);
  const res = await put(doc, '<p data-af-id="kept">A</p><p data-af-id="gone">B</p>');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid_html', details: ['Cannot reuse retired data-af-id: gone'] });
});

it('logs a database failure and answers a fixed message without its text', async () => {
  const doc = await page('<p data-af-id="p">A</p>');
  const logged: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });
  const db = await harness.db();
  await db.query('ALTER TABLE artifact_source_ids RENAME TO artifact_source_ids_hidden');
  let res: Response;
  try { res = await put(doc, '<p data-af-id="p">B</p>'); }
  finally { await db.query('ALTER TABLE artifact_source_ids_hidden RENAME TO artifact_source_ids'); }
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).not.toContain('invalid_html');
  expect(text).not.toContain('artifact_source_ids');
  expect(logged.map(args => args.map(String).join(' ')).join('\n')).toContain('artifact_source_ids');
  expect((await getArtifactById(doc.id))!.version).toBe(1);
});
