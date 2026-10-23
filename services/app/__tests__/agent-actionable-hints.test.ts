/** HTTP refusals identify native fields and live recovery guides. */
import {nativeSource} from './native-publication-fixture';
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as preflightRoute } from '@/app/api/artifacts/preflight/route';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { GET as listAnnotations, POST as createAnnotation } from '@/app/api/artifacts/[id]/annotations/route';
import { DELETE as deleteAnnotation } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { accountProfile, updateAccountProfile } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, claimToken, createUser } from '@/lib/accounts';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const body = async (r: Response) => (await r.json()) as Record<string, any>;

const create = async (token: string, input: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: {visibility:'public',...input} }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number; state: string };
};

async function claimed(name = 'owner') {
  const u = await createUser({ email: `${name}@example.com` });
  const t = await mintToken(name, u.id);
    await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, userId: u.id };
}



describe('native HTTP actionable refusals', () => {
  it('an invalid slide names the HTTP slide parameter', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { html: nativeSource('<section data-af-slide><h1>One</h1></section>') });
    const res = await exportImage(request(`/a/${id}/export?slide=two`), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('unknown_slide');
    expect(refusal.hint).toContain('slide');
  });

  it('a corrupt listing cursor names the cursor parameter', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { html: nativeSource('<p>Body</p>') });
    const res = await listAnnotations(request(`/api/artifacts/${id}/annotations?cursor=not-a-cursor`, { token: t.token }), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('invalid_cursor');
    expect(refusal.hint).toContain('cursor');
    expect(refusal.hint).not.toMatch(/endpoint/);
  });

  it('deleting a comment on an unclaimed token links HTTP authentication', async () => {
    const t = await mintToken('anon',null);
    const { id } = await create((await mintToken('owner')).token, { html: nativeSource('<p>Body</p>') });
    const res = await deleteAnnotation(request(`/api/artifacts/${id}/annotations/ann_1`, { method: 'DELETE', token: t.token }), params({ id, annId: 'ann_1' }));
    expect(res.status).toBe(401);
    const refusal = await body(res);
    expect(refusal.error).toBe('unauthorized');
    expect(refusal.help).toContain('/llms/http-auth');
  });

  it('a malformed comment names body and anchor', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { html: nativeSource('<p>Body</p>') });
    const res = await createAnnotation(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token: t.token, json: { body: 'hi' } }), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('invalid_annotation_body');
    expect(refusal.hint).toContain('body');
    expect(refusal.hint).toContain('anchor');
    expect(refusal.hint).toContain('anchor');
  });

  it('an unresolved HTML anchor is refused', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { html: nativeSource('<p>Twice here. Twice here.</p>') });
    const res = await createAnnotation(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token: t.token, json: { body: 'hi', anchor: {kind:'html-node',v:1,revision:'1',nodeId:'missing',quote:'absent'} } }), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBeTruthy();
  });

  it('a folder refuses content without suggesting placement changes', async () => {
    const o = await claimed('folderowner');
    const folder = await create(o.token, { format: 'folder', title: 'Reports' });
    const res = await putArtifactRoute(
      request(`/api/artifacts/${folder.id}`, { method: 'PUT', token: o.token, json: { dataset: [{value:1}], expectedVersion: folder.version, expectedState: folder.state } }),
      params({ id: folder.id }),
    );
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('not_editable');
    expect(String(refusal.details[0])).toContain('folder');
    expect(String(refusal.details[0])).not.toContain('parent_id');
  });

  /*
   * The refusal stays ONE undifferentiated code — naming which condition failed
   * would reveal whether an id exists (lib/folders). A single sentence that
   * lists every condition differentiates nothing, and it is the difference
   * between `invalid_parent: Bad Request` and a recovery the agent can run.
   */
  it('a bad folder placement explains parent_id and folder creation', async () => {
    const o = await claimed('placer');
    const doc = await create(o.token, { html: nativeSource('<p>Body</p>') });
    for (const parent_id of ['zzzzzz', doc.id, 'not a real id']) {
      const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: o.token, json: { html: nativeSource('<p>x</p>'), parent_id } }));
      expect(res.status, parent_id).toBe(400);
      const refusal = await body(res);
      expect(refusal.error, parent_id).toBe('invalid_parent');
      // The same sentence for every cause: an existence oracle needs a difference.
      expect(refusal.hint, parent_id).toContain('parent_id');
      expect(refusal.hint, parent_id).toContain('folder');
    }
  });

  it('a stale profile write names the profile HTTP read', async () => {
    const o = await claimed('profileowner');
    const current = await accountProfile(o.userId);
    // A well-formed observed state that is not the current one: someone moved the profile on.
    const result = await updateAccountProfile(identityForUser(o.userId, o.tokenId), { ...current, state: 'a'.repeat(64) });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('state_conflict');
    expect(String(result.body.hint)).toContain('/api/account/profile');
  });
});

/**
 * THE OTHER VERDICT. `file_not_previewable`, `image_not_previewable` and
 * `pdf_not_previewable` still say "POST it to /api/artifacts" — and they stay
 * that way, because the only caller that omits `overByteQuota` is
 * `/api/preview`, a route afbin never addresses. `afbin push <file> --dry-run`
 * goes to `/api/artifacts/preflight`, which charges the quota and therefore
 * takes the tier. These two pin that trace so the verdict stays observed.
 */
describe('media preflight refusals', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('preflighting an image create (what push --dry-run sends) never answers image_not_previewable', async () => {
    const t = await mintToken('t');
    const res = await preflightRoute(request('/api/artifacts/preflight', { method: 'POST', token: t.token, json: { input: { image: `data:image/png;base64,${PNG}` } } }));
    expect((await body(res)).error).not.toBe('image_not_previewable');
    expect(res.status).toBe(200);
  });

  it('preflighting a file create never answers file_not_previewable', async () => {
    const t = await mintToken('t');
    const file = { filename: 'notes.txt', contentType: 'text/plain', base64: Buffer.from('hello').toString('base64') };
    const res = await preflightRoute(request('/api/artifacts/preflight', { method: 'POST', token: t.token, json: { input: { file } } }));
    expect((await body(res)).error).not.toBe('file_not_previewable');
    expect(res.status).toBe(200);
  });
});
