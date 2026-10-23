import {restoreDocument} from './prepared-document';
import {observedRequest} from '@/__tests__/conditional-request';
/**
 * Document-tier lifecycle over the story engine: format switching, versioning
 * and revert, user-scope editing, and the preview compile. (Creation-path
 * contracts live in markup-tier.test.ts; this file covers the flows AROUND
 * publish.) The retired static render tiers have no input path anymore — see
 * the pre-engine coverage in markup-tier.test.ts for how their rows serve.
 */
import { describe, expect, it } from 'vitest';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as previewRoute } from '@/app/api/preview/route';
import { replaceArtifactFor,artifactState,getArtifactById } from '@/lib/artifacts';


import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();


const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('document creation guards', () => {
  it('rejects a retired input, no input, and an unknown theme', async () => {
    const t = await mintToken('t');
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ markup: '<p>x</p>', markdown: '# x' }, 'markup_only'],
      [{ title: 'x' }, 'one_of_markup_dataset_viz_image_pdf'],
      [{ markup: '<p>x</p>', theme: 'vaporwave' }, 'unknown_theme'],
    ];
    for (const [body, error] of cases) {
      const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: body }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    }
  });

  it('rejects a retired theme name as unknown, listing the live names', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>x</p>', theme: 'classical' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_theme');
    expect(body.allowed).toContain('manuscript');
  });
});

describe('themes on stored rows', () => {
  it('rebuilds stale stored nocturne styling consistently on cold and prepared reads', async () => {
    const t = await mintToken('t');
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', markup: '<h1>Legacy</h1>', theme: 'modernist' } }),
      )
    ).json();
    // Let the publish warmup finish before simulating a legacy stored row.
    const db = await harness.db();
    await db.query(
      `UPDATE artifacts SET meta = meta || '{"theme":"nocturne","colorMode":null,"cssCompileVersion":"v-legacy","compiledCss":".stale-theme-sentinel{}"}' WHERE id = $1`,
      [created.id],
    );
    await db.query('DELETE FROM prepared_pages WHERE artifact_id = $1', [created.id]);
    for (const phase of ['cold', 'prepared']) {
      const res = await serveArtifact(request(`/a/${created.id}/raw`), params({ id: created.id }));
      expect(res.status, phase).toBe(200);
      const html = await res.text();
      expect(html, phase).toMatch(/<html[^>]*data-theme="nocturne"/);
      expect(html, phase).toMatch(/<html[^>]*class="dark"/);
      expect(html, phase).not.toContain('stale-theme-sentinel');
      expect(html, phase).toContain('[data-theme="nocturne"]');
      }
  });
});

describe('document editing', () => {
  it('PUT republishes; revert restores the old source and theme', async () => {
    const t = await mintToken('t');
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>First</h1>', theme: 'manuscript' } }),
      )
    ).json();
    expect(created.format).toBe('markup');

    const put = await putArtifact(
      await observedRequest(`/api/artifacts/${created.id}`, { method: 'PUT', token: t.token, json: { markup: '<h1>Second</h1>', theme: 'industry' } }),
      params({ id: created.id }),
    );
    expect(put.status).toBe(200);
    expect((await put.json()).version).toBe(2);

    let read = await (
      await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: t.token }), params({ id: created.id }))
    ).json();
    expect(read.markup).toContain('Second');
    expect(read.theme).toBe('industry');

    const revert = await restoreDocument(t.token,created.id,1);
    expect(revert.status).toBe(200);

    read = await (
      await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: t.token }), params({ id: created.id }))
    ).json();
    expect(read.markup).toContain('First');
    expect(read.markup).not.toContain('Second');
    expect(read.theme).toBe('manuscript');
    expect(read.format).toBe('markup');
  });

  it('an account-scope native replacement edits only artifacts that user may edit',async()=>{
    const user=await createUser({email:'native-scope@example.com'}),t=await mintToken('laptop',user.id);
    const response=await createArtifactRoute(request('/api/artifacts',{method:'POST',token:t.token,json:{html:'<html><body><h1>Mine</h1></body></html>'}}));expect(response.status).toBe(201);const created=await response.json();
    const head=(await getArtifactById(created.id))!;
    const input={...head,link_role:head.link_role??undefined,source:head.source!.replace('Mine','Edited')};
    const opts={expectedVersion:head.version,expectedState:artifactState(head)};
    const result=await replaceArtifactFor(identityForUser(user.id,''),head.id,input,opts);expect(result).toMatchObject({version:2,format:'html',source:expect.stringContaining('Edited')});
    const other=await createUser({email:'native-other@example.com'});expect(await replaceArtifactFor(identityForUser(other.id,''),head.id,input,opts)).toBeNull();
  });

  it('preview compiles the document tier without persisting (bearer auth)', async () => {
    const t = await mintToken('t');
    const res = await previewRoute(
      request('/api/preview', { method: 'POST', token: t.token, json: { markup: '<h1 className="text-2xl font-bold">Draft</h1>' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { format: string; css?: string | null };
    expect(body.format).toBe('markup');
    expect(typeof body.css).toBe('string'); // the compiled per-story sheet
    expect(body.css).toContain('text-2xl');

    // A document carrying markdown previews through the same engine.
    const md = await previewRoute(
      request('/api/preview', { method: 'POST', token: t.token, json: { markup: '<h1>Draft</h1>' } }),
    );
    expect(((await md.json()) as { format: string }).format).toBe('markup');

    const noAuth = await previewRoute(request('/api/preview', { method: 'POST', json: { markup: '<p>x</p>' } }));
    expect(noAuth.status).toBe(401);
  });
});
