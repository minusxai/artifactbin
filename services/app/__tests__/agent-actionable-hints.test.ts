/**
 * EVERY REFUSAL AN AGENT CAN REACH MUST NAME AN afbin ACTION.
 *
 * Agents drive this product through one door — the `afbin` CLI (the installed
 * skill says so) — and `services/cli/src/http.ts` hands the server's `hint`,
 * `recovery` and `details` to that agent VERBATIM as the refusal's fix. So a
 * hint that names an HTTP route, a wire field the CLI writes on the agent's
 * behalf (`parent_id`, `expectedVersion`), a query parameter (`?slide=`) or an
 * operation name (`list_versions`) spends the agent's turns teaching it a door
 * it cannot open. The repo already answers in CLI vocabulary where it counts
 * (`--cursor` in lib/operations/registry, `--name` in lib/resource-query); these
 * are the reachable refusals that still did not.
 *
 * Each case below goes through the REAL handler an afbin command reaches, and
 * the last two record the opposite verdict: the preview-tier refusals are
 * unreachable from the CLI, which is why their wording is left alone.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as preflightRoute } from '@/app/api/artifacts/preflight/route';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { GET as listAnnotations, POST as createAnnotation } from '@/app/api/artifacts/[id]/annotations/route';
import { DELETE as deleteAnnotation } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { runOperation } from '@/lib/operations/http';
import { remoteRoute } from '@/lib/remote/route';
import { accountProfile, updateAccountProfile } from '@/lib/account-profile';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { MAX_EXTERNAL_IMAGES_PER_PUBLISH } from '@/lib/config';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const body = async (r: Response) => (await r.json()) as Record<string, any>;

const create = async (token: string, input: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: input }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number; state: string };
};

async function claimed(name = 'owner') {
  const t = await mintToken(name);
  const u = await createUser({ email: `${name}@example.com` });
  await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, userId: u.id };
}

const DECK = '<SlideDeck><Slide title="one"><h1>First</h1></Slide><Slide title="two"><h1>Second</h1></Slide></SlideDeck>';

describe('refusals an afbin command reaches name the afbin action', () => {
  it('a slide past the deck names --page, not the ?slide= query parameter (afbin export --page)', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { markup: DECK });
    const res = await exportImage(request(`/a/${id}/export?slide=two`), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('unknown_slide');
    expect(refusal.hint).toContain('--page');
    expect(refusal.hint).not.toContain('?slide=');
  });

  it('a corrupt listing cursor names --cursor, not a "listing endpoint" (afbin comment --cursor)', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { markup: '<p>Body</p>' });
    const res = await listAnnotations(request(`/api/artifacts/${id}/annotations?cursor=not-a-cursor`, { token: t.token }), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('invalid_cursor');
    expect(refusal.hint).toContain('--cursor');
    expect(refusal.hint).not.toMatch(/endpoint/);
  });

  it('deleting a comment on an unclaimed token names afbin auth, not "a token claimed by your account"', async () => {
    const t = await mintToken('anon');
    const { id } = await create(t.token, { markup: '<p>Body</p>' });
    const res = await deleteAnnotation(request(`/api/artifacts/${id}/annotations/ann_1`, { method: 'DELETE', token: t.token }), params({ id, annId: 'ann_1' }));
    expect(res.status).toBe(403);
    const refusal = await body(res);
    expect(refusal.error).toBe('account_required');
    expect(refusal.hint).toContain('afbin auth');
  });

  it('a session listing on an unclaimed token names afbin auth (afbin list --type session)', async () => {
    const t = await mintToken('anon');
    const res = await runOperation('list_remote_sessions', request('/api/sessions', { token: t.token }), { tokenId: t.id, userId: null }, {});
    expect(res.status).toBe(403);
    const refusal = await body(res);
    expect(refusal.error).toBe('account_required');
    expect(refusal.hint).toContain('afbin auth');
  });

  it('the remote relay refuses an anonymous credential by naming afbin auth (afbin remote)', async () => {
    const t = await mintToken('anon');
    const res = await remoteRoute(request('/api/remote/sessions', { method: 'POST', token: t.token, json: { name: 'Shell', harness: 'claude', cwd: '/p', machine: 'laptop', cols: 80, rows: 24 } }));
    expect(res.status).toBe(403);
    expect(String((await body(res)).error)).toContain('afbin auth');
  });

  it('a malformed comment names the flags that carry it (afbin comment --body/--node/--quote)', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { markup: '<p>Body</p>' });
    const res = await createAnnotation(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token: t.token, json: { body: 'hi', node_id: 'a', quote: 'Body' } }), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('invalid_annotation_body');
    expect(refusal.hint).toContain('--body');
    expect(refusal.hint).toContain('--node');
    expect(refusal.hint).toContain('--quote');
  });

  it('an anchor that does not resolve names --quote and --node, not node_id', async () => {
    const t = await mintToken('t');
    const { id } = await create(t.token, { markup: '<p>Twice here. Twice here.</p>' });
    const res = await createAnnotation(request(`/api/artifacts/${id}/annotations`, { method: 'POST', token: t.token, json: { body: 'hi', quote: 'Twice here.' } }), params({ id }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.hint).toContain('--quote');
    expect(refusal.hint).toContain('--node');
    expect(refusal.hint).not.toContain('node_id');
  });

  it('too many external images tells the agent to push local files, not to "upload image artifacts"', async () => {
    const t = await mintToken('t');
    const images = Array.from({ length: MAX_EXTERNAL_IMAGES_PER_PUBLISH + 1 }, (_, i) => `<img src="https://example.test/${i}.png" />`).join('');
    const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: `<main>${images}</main>` } }));
    expect(res.status).toBe(400);
    const refusal = await body(res);
    expect(refusal.error).toBe('too_many_external_images');
    expect(String(refusal.details[0])).toContain('afbin push');
    expect(String(refusal.details[0])).not.toContain('upload the rest as image artifacts');
  });

  it('a folder refuses content by naming its YAML fields, not parent_id on the wire', async () => {
    const o = await claimed('folderowner');
    const folder = await create(o.token, { format: 'folder', title: 'Reports' });
    const res = await putArtifactRoute(
      request(`/api/artifacts/${folder.id}`, { method: 'PUT', token: o.token, json: { markup: '<p>nope</p>', expectedVersion: folder.version, expectedState: folder.state } }),
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
  it('a bad folder placement carries a hint at all, and it names the fence field and the folder YAML', async () => {
    const o = await claimed('placer');
    const doc = await create(o.token, { markup: '<p>Body</p>' });
    for (const parent_id of ['zzzzzz', doc.id, 'not a real id']) {
      const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: o.token, json: { markup: '<p>x</p>', parent_id } }));
      expect(res.status, parent_id).toBe(400);
      const refusal = await body(res);
      expect(refusal.error, parent_id).toBe('invalid_parent');
      // The same sentence for every cause: an existence oracle needs a difference.
      expect(refusal.hint, parent_id).toContain('folder:');
      expect(refusal.hint, parent_id).toContain('type: folder');
    }
  });

  it('a stale profile write names afbin pull --type profile', async () => {
    const o = await claimed('profileowner');
    const current = await accountProfile(o.userId);
    // A well-formed observed state that is not the current one: someone moved the profile on.
    const result = await updateAccountProfile({ tokenId: o.tokenId, userId: o.userId }, { ...current, state: 'a'.repeat(64) });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('state_conflict');
    expect(String(result.body.hint)).toContain('afbin pull --type profile');
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
describe('the preview-tier refusals are not on any afbin path', () => {
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
