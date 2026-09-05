/**
 * THE ANCHOR LIVES IN THE DOCUMENT — `data-annotation-anchor="<key>"` on the annotated
 * node, stamped by the FIRST comment as a real edit through the protocol
 * (version bump, CAS, conflict check and all). Resolution is a lookup in the
 * CURRENT source, which is what makes it robust where spans were fragile:
 *  - a full-replace PUT that KEEPS the attribute keeps the annotation;
 *  - dropping the attribute orphans it — and orphaned is COMPUTED PER READ,
 *    so putting the text back (or reverting forward) re-anchors it;
 *  - revert below the comment's version orphans it honestly (the thing
 *    commented on does not exist there) and revert forward restores it.
 */
import { describe, expect, it } from 'vitest';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as myDeleteAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';


import { mintToken } from '@/lib/tokens';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const DOC = '<p>An intro paragraph here.</p><div>Revenue grew 40% in Q3.</div>';

interface AnnotationWire {
  id: string;
  orphaned: boolean;
  anchor: { key: string; nodeId?: string; path: string; spanStart: number; spanEnd: number } | null;
  anchor_version: number | null;
  snippet: string;
}

interface HeadWire { edit_id: string; version: number; markup: string }

const head = async (token: string, id: string): Promise<HeadWire> => {
  const res = await getArtifactRoute(request(`/api/artifacts/${id}`, { token: token }), params({ id }));
  expect(res.status).toBe(200);
  return (await res.json()) as HeadWire;
};

async function setup() {
  const t = await mintToken('agent');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const doc = (await res.json()) as { id: string; edit_id: string; version: number };
  const cookie = await agentCookie([t.id]);
  // Annotate the <div> — body path '1' (no Helmet in this fixture, so body == source).
  const made = await myCreateAnnotationRoute(
    request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', cookie: cookie, json: { path: '1', edit_id: doc.edit_id, body: 'check this figure' } }),
    params({ id: doc.id }),
  );
  expect(made.status, await made.clone().text()).toBe(201);
  const ann = (await made.json()) as AnnotationWire;
  return { t, doc, cookie, ann };
}

const list = async (token: string, id: string) => {
  const res = await listAnnotationsRoute(request(`/api/artifacts/${id}/annotations`, { token: token }), params({ id }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { annotations: AnnotationWire[] }).annotations;
};

const put = async (token: string, id: string, markup: string) => {
  const res = await putArtifactRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: token, json: { markup } }), params({ id }));
  expect(res.status, await res.clone().text()).toBe(200);
};

describe('the annotation anchor', () => {
  it('the first comment relates to existing source identity without editing the document', async () => {
    const { t, doc, ann } = await setup();
    const h = await head(t.token, doc.id);
    expect(h.version).toBe(doc.version);
    expect(h.edit_id).toBe(doc.edit_id);
    expect(h.markup).not.toContain('data-annotation-anchor');
    expect(ann.anchor?.nodeId).toBe(ann.anchor!.key);
    expect(ann.anchor_version).toBe(doc.version);
  });

  it('an ordinary edit elsewhere leaves the anchor standing', async () => {
    const { t, doc, ann } = await setup();
    const h = await head(t.token, doc.id);
    const edited = await editsRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: t.token, json: { edit_id: h.edit_id, old_string: 'An intro paragraph here.', new_string: 'A different opening.' } }),
      params({ id: doc.id }),
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const [a] = await list(t.token, doc.id);
    expect(a.orphaned).toBe(false);
    expect(a.anchor?.key).toBe(ann.anchor!.key);
  });

  it('a full-replace PUT that KEEPS the attribute keeps the annotation — the fragile case the ids exist for', async () => {
    const { t, doc, ann } = await setup();
    const key = ann.anchor!.key;
    await put(t.token, doc.id, `<h1>All new</h1><div data-annotation-anchor="${key}">Revenue grew 34% in Q3, recomputed.</div>`);
    const [a] = await list(t.token, doc.id);
    expect(a.orphaned).toBe(false);
    expect(a.anchor?.key).toBe(key);
    expect(a.snippet).toContain('34%'); // the snippet follows the node's current text
  });

  it('dropping the attribute orphans; putting it back re-anchors — orphaned is a state, not a tombstone', async () => {
    const { t, doc, ann } = await setup();
    const key = ann.anchor!.key;
    await put(t.token, doc.id, '<p>regenerated from scratch, attribute lost</p>');
    const [orphaned] = await list(t.token, doc.id);
    expect(orphaned.orphaned).toBe(true);
    expect(orphaned.anchor).toBeNull();
    expect(orphaned.snippet).toContain('40%'); // capture-time text — nothing current to derive from

    await put(t.token, doc.id, `<p>restored</p><div data-annotation-anchor="${key}">Revenue grew 40% in Q3.</div>`);
    const [restored] = await list(t.token, doc.id);
    expect(restored.orphaned).toBe(false);
    expect(restored.anchor?.key).toBe(key);
  });

  it('reverting an archived source restores its comment relation by source id', async () => {
    const { t, doc, ann } = await setup();
    await put(t.token,doc.id,'<p>replacement</p>');
    expect((await list(t.token,doc.id))[0].orphaned).toBe(true);
    const back = await revertRoute(
      request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: t.token, json: { version: doc.version } }),
      params({ id: doc.id }),
    );
    expect(back.status, await back.clone().text()).toBe(200);
    const [below] = await list(t.token, doc.id);
    expect(below.orphaned).toBe(false);
    expect(below.anchor?.key).toBe(ann.anchor!.key);
  });

  it('a second comment on the same node reuses its key — no second attribute, no version bump', async () => {
    const { t, doc, cookie, ann } = await setup();
    const h = await head(t.token, doc.id);
    const second = await myCreateAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', cookie: cookie, json: { path: '1', edit_id: h.edit_id, body: 'also this' } }),
      params({ id: doc.id }),
    );
    expect(second.status, await second.clone().text()).toBe(201);
    const b = (await second.json()) as AnnotationWire;
    expect(b.anchor?.key).toBe(ann.anchor!.key);
    const after = await head(t.token, doc.id);
    expect(after.version).toBe(h.version);
    expect((after.markup.match(/data-annotation-anchor=/g) ?? []).length).toBe(0);
  });

  it('deleting the last thread on a node cleans its attribute back out of the source', async () => {
    const { t, doc, cookie, ann } = await setup();
    const del = await myDeleteAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${ann.id}`, { method: 'DELETE', cookie: cookie }),
      params({ id: doc.id, annId: ann.id }),
    );
    expect(del.status).toBe(200);
    const h = await head(t.token, doc.id);
    expect(h.markup).not.toContain('data-annotation-anchor');
  });

  it('a prior comment does not stale the document head', async () => {
    const { t, doc, cookie } = await setup();
    const res = await myCreateAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', cookie: cookie, json: { path: '0', edit_id: doc.edit_id, body: 'x' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(201);
    expect((await head(t.token, doc.id)).edit_id).toBe(doc.edit_id);
  });
});
