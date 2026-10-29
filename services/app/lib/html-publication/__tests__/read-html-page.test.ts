import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { ANONYMOUS_ACTOR, identityForUser } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { artifactState, getArtifactById } from '@/lib/artifacts';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { readHtmlPage } from '..';

useAppHarness();
const html = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
async function page(visibility = 'private') {
  const owner = await mintAccountToken('html-page-owner');
  const made = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: html('<p>First</p>'), visibility } }));
  expect(made.status).toBe(201);
  const doc = await made.json() as { id: string };
  const saved = await replace(request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: owner.token, json: { html: html('<p>Second ü</p>'), expectedVersion: 1, expectedState: artifactState((await getArtifactById(doc.id))!) } }), { params: Promise.resolve({ id: doc.id }) });
  expect(saved.status, await saved.clone().text()).toBe(200);
  return { owner, id: doc.id, actor: identityForUser(owner.userId!, owner.id) };
}

describe('readHtmlPage', () => {
  it('reads the head by default and an archived revision by number, with their identity ledgers', async () => {
    const { id, actor } = await page();
    const head = await readHtmlPage(actor, id);
    expect(head).toMatchObject({ pageId: id, version: 2, revision: '2', links: [] });
    expect(head.html).toContain('Second ü');
    expect(head.nextNodeId).toBeGreaterThanOrEqual(1);
    expect(await readHtmlPage(actor, id, '2')).toEqual(head);
    const first = await readHtmlPage(actor, id, '1');
    expect(first).toMatchObject({ version: 1, revision: '1' });
    expect(first.html).toContain('First');
  });

  it('refuses malformed and missing revisions', async () => {
    const { id, actor } = await page();
    for (const revision of ['0', '01', '-1', '1.0', 'abc', '', '99', '9007199254740993'])
      await expect(readHtmlPage(actor, id, revision)).rejects.toThrow('Page revision not found');
  });

  it('keeps the artifact ACL as the authority: strangers, anonymous readers and deleted pages are refused', async () => {
    const { id } = await page();
    const stranger = await mintAccountToken('html-page-stranger');
    await expect(readHtmlPage(identityForUser(stranger.userId!, stranger.id), id)).rejects.toThrow('Page not found');
    await expect(readHtmlPage(ANONYMOUS_ACTOR, id)).rejects.toThrow('Page not found');
    await expect(readHtmlPage(ANONYMOUS_ACTOR, 'missing-page')).rejects.toThrow('Page not found');
  });

  it('lets anyone read a public page, but never an archived revision once the page is deleted', async () => {
    const { id, actor } = await page('public');
    expect((await readHtmlPage(ANONYMOUS_ACTOR, id, '1')).version).toBe(1);
    await (await getDb()).query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [id]);
    await expect(readHtmlPage(actor, id, '1')).rejects.toThrow('not found');
  });

  it('refuses an artifact that is not an HTML page', async () => {
    const owner = await mintAccountToken('html-page-dataset');
    const made = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: [{ a: 1 }] } }));
    expect(made.status).toBe(201);
    const { id } = await made.json() as { id: string };
    await expect(readHtmlPage(identityForUser(owner.userId!, owner.id), id)).rejects.toThrow('Page not found');
  });
});
