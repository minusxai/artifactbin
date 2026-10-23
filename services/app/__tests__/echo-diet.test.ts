/** Native publication echoes a complete canonical HTML file; compiler graph/splice echoes are retired. */
import { beforeEach, expect, it } from 'vitest';
import { POST } from '@/app/api/artifacts/route';
import { GET, PUT, PATCH } from '@/app/api/artifacts/[id]/route';
import { mintAccountToken, request, useAppHarness } from './harness';
import { observedRequest } from './conditional-request';
import { nativeHtml } from './native-html-fixture';
useAppHarness();
let token: string;
beforeEach(async () => {
  token = (await mintAccountToken('echo')).token;
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const source = nativeHtml(
  '<h1 data-af-id="heading">Title</h1><p data-af-id="body">Body copy.</p>',
);
async function create(html = source) {
  const response = await POST(
    request('/api/artifacts', { method: 'POST', token, json: { html } }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json();
}
it('returns canonical HTML and publication identity without legacy graph/markup fields', async () => {
  const made = await create();
  expect(made.html).toContain('data-af-id="body"');
  expect(made.id).toMatch(/^[A-Za-z0-9]{6,12}$/);
  expect(made.edit_id).toEqual(expect.any(String));
  expect(made.url).toContain('/a/');
  expect(made.markup).toBeUndefined();
  expect(made.document).toBeUndefined();
});
it('echoes parser normalization and assigned identities so the caller can preserve them', async () => {
  const input = nativeHtml('<p>Before<div>Block</div></p>'),
    made = await create(input);
  expect(made.html).not.toBe(input);
  expect(made.html).toContain('data-af-id=');
  const read = await GET(
    request(`/api/artifacts/${made.id}`, { token }),
    params(made.id),
  );
  expect((await read.json()).html).toBe(made.html);
});
it('whole-source PUT echoes the new canonical file and preserves stable node identities', async () => {
  const made = await create(),
    html = made.html.replace('Body copy.', 'Different copy.');
  const response = await PUT(
    await observedRequest(`/api/artifacts/${made.id}`, {
      method: 'PUT',
      token,
      json: { html },
    }),
    params(made.id),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.html).toContain('Different copy.');
  expect(body.html).toContain('data-af-id="body"');
  expect(body.version).toBe(2);
  expect(body.markup).toBeUndefined();
  expect(body.document).toBeUndefined();
});
it('metadata-only PATCH preserves the canonical file and changes only metadata', async () => {
  const made = await create(),
    response = await PATCH(
      await observedRequest(`/api/artifacts/${made.id}`, {
        method: 'PATCH',
        token,
        json: { title: 'Named' },
      }),
      params(made.id),
    );
  expect(response.status).toBe(200);
  const body = await (
    await GET(request(`/api/artifacts/${made.id}`, { token }), params(made.id))
  ).json();
  expect(body.title).toBe('Named');
  expect(body.html).toBe(made.html);
});
