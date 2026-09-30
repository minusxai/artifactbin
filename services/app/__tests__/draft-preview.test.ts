import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as preview } from '@/app/a/[id]/draft-preview/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';

vi.mock('@/auth', () => ({ auth: async () => null }));
useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('the editor draft preview door', () => {
  it('resolves a newly uploaded image before the draft has been saved', async () => {
    const { token } = await mintToken('draft-preview-image');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_image_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const image = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    } }));
    expect(image.status).toBe(201);
    const imageId = ((await image.json()) as { id: string }).id;
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Draft', markup: '<div><p>Before</p></div>', visibility: 'private',
    } }));
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: {
      editId: row.edit_id, source: `<div><p>Before</p><img src="ref:${imageId}" /></div>`,
    } }), params(id));
    expect(answer.status).toBe(200);
    const document = new JSDOM(((await answer.json()) as { html: string }).html).window.document;
    expect(document.querySelector('img')?.getAttribute('src')).toContain(`/a/${imageId}/raw`);
    expect((await getArtifactById(id))?.source).not.toContain(imageId);
  });
  it('renders a query document through its matching server island build', async () => {
    const { token } = await mintToken('draft-preview-query');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_query_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const dataset = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Rows', dataset: [{ label: 'first', value: 42 }],
    } }));
    expect(dataset.status).toBe(201);
    const datasetId = ((await dataset.json()) as { id: string }).id;
    const source = `<Helmet><Import name="rows_data" src="ref:${datasetId}" /><Query name="rows">` + '{`select * from rows_data.rows`}' + '</Query></Helmet><div><p>Before</p><Question data="$rows" /></div>';
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: { title: 'Draft', markup: source, visibility: 'private' } }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: {
      editId: row.edit_id, source: source.replace('Before', 'After'),
    } }), params(id));
    expect(answer.status).toBe(200);
    const document = new JSDOM(((await answer.json()) as { html: string }).html).window.document;
    expect(document.querySelector('p')?.textContent).toBe('After');
  });
  it('compiles an admitted unsaved draft without changing the published source', async () => {
    const { token } = await mintToken('draft-preview');
    const user = await ensureUsername(await createUser({ email: `mxmx_test_draft_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    await claimToken(user.id, token);
    const made = await createArtifact(request('/api/artifacts', { method: 'POST', token, json: {
      title: 'Draft', markup: '<div id="root"><p id="copy">Published</p></div>', visibility: 'private',
    } }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const row = (await getArtifactById(id))!;
    const body = { editId: row.edit_id, source: '<div id="root"><p id="copy">Unsaved</p></div>' };
    const guest = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', json: body }), params(id));
    expect(guest.status).toBe(404);
    // A save can land between the editor's draft and its preview: the draft still renders.
    const stale = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: { ...body, editId: 'stale' } }), params(id));
    expect(stale.status).toBe(200);
    const answer = await preview(request(`/a/${id}/draft-preview`, { method: 'POST', token, json: body }), params(id));
    expect(answer.status).toBe(200);
    const document = new JSDOM(((await answer.json()) as { html: string }).html).window.document;
    expect(document.querySelector('#copy')?.textContent).toBe('Unsaved');
    expect(document.querySelector('#copy')?.getAttribute('data-mx-ast')).toBe('0.0');
    expect((await getArtifactById(id))?.source).toContain('Published');
  });
});
