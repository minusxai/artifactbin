import {observedRequest} from '@/__tests__/conditional-request';
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
import { PUT as replaceArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { createAnnotationFor } from '@/lib/annotations';
import { DELETE as myDeleteAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';


import { mintToken } from '@/lib/tokens';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

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
  const res = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: token, json: { markup } }), params({ id }));
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
      await observedRequest(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: t.token, json: { version: doc.version } }),
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

/**
 * The SAME concern one layer up: a merge that moves an anchor commits the
 * source and the relation together, and undo puts both back.
 */
describe('annotation ops through an edit', () => {
  const MERGE_BEFORE = '<p id="a">same same</p><p id="b">same same</p>';
  const MERGE_AFTER = '<p id="a">same Xsame</p>';
  const MERGE_OP = {
    id: '12345678-1234-1234-1234-123456789012',
    kind: 'map',
    maps: [
      {
        fromId: 'b',
        toId: 'a',
        fromText: 'same same',
        toText: 'same Xsame',
        segments: [{ from: 5, to: 6, length: 4 }],
      },
    ],
  };
  it('commits merge source and exact relation together, restores on undo, and preserves independently changed relations', async () => {
    const token = await mintToken('mxmx_test_editor_v2');
    const made = await createArtifactRoute(
      request('/api/artifacts', {
        method: 'POST',
        token: token.token,
        json: { markup: MERGE_BEFORE },
      }),
    );
    expect(made.status).toBe(201);
    const doc = await made.json();
    const comment = await createAnnotationFor(
      { tokenId: token.id, userId: null },
      doc.id,
      {
        nodeId: 'b',
        body: 'suffix',
        quote: 'same',
        range: { v: 1, parts: [{ rel: '', start: 5, end: 9, text: 'same' }] },
      },
      { kind: 'human', label: 'Tester', transport: 'browser' },
    );
    expect(comment).toBeTruthy();
    const head = async () => {
      const r = await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: token.token }), params({ id: doc.id }));
      return r.json();
    };
    const change = async (source: string, ops: unknown[], bearer = token.token) => {
      const current = await head();
      return editsRoute(
        request(`/api/artifacts/${doc.id}/edits`, {
          method: 'POST',
          token: bearer,
          json: { edit_id: current.edit_id, source, annotation_ops: ops },
        }),
        params({ id: doc.id }),
      );
    };
    const merged = await change(MERGE_AFTER, [MERGE_OP]);
    expect(merged.status, await merged.clone().text()).toBe(200);
    let current = await head();
    expect(current.markup).toBe(MERGE_AFTER);
    expect(current.annotations[0].anchor.key).toBe('a');
    expect(current.annotations[0].range.parts[0]).toMatchObject({
      start: 6,
      end: 10,
    });
    expect((await change(MERGE_BEFORE, [{ id: MERGE_OP.id, kind: 'undo' }])).status).toBe(200);
    current = await head();
    expect(current.annotations[0].anchor.key).toBe('b');
    expect(current.annotations[0].range.parts[0]).toMatchObject({
      start: 5,
      end: 9,
    });
    expect((await change(MERGE_AFTER, [{ id: MERGE_OP.id, kind: 'redo' }])).status).toBe(200);
    const db = await harness.db();
    await db.query('UPDATE annotations SET range=$1 WHERE artifact_id=$2', [
      JSON.stringify({
        v: 1,
        parts: [{ rel: '', start: 0, end: 4, text: 'same' }],
      }),
      doc.id,
    ]);
    expect((await change(MERGE_BEFORE, [{ id: MERGE_OP.id, kind: 'undo' }])).status).toBe(200);
    current = await head();
    expect(current.annotations[0].anchor.key).toBe('a');
    expect(current.annotations[0].range.parts[0].start).toBe(0);
    const stable = await head();
    expect(
      (
        await change(MERGE_AFTER, [
          { ...MERGE_OP, maps: [{ ...MERGE_OP.maps[0], segments: [{ from: -1, to: 0, length: 4 }] }] },
        ])
      ).status,
    ).toBe(400);
    expect((await change('<script>bad</script>', [MERGE_OP])).status).toBe(400);
    expect((await change(MERGE_AFTER, [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', kind: 'undo' }])).status).toBe(409);
    const refused = await head();
    expect(refused.markup).toBe(stable.markup);
    expect(refused.annotations[0].anchor).toEqual(stable.annotations[0].anchor);
    expect(refused.annotations[0].range).toEqual(stable.annotations[0].range);
    const foreign = await mintToken('mxmx_test_other');
    expect((await change(MERGE_AFTER, [MERGE_OP], foreign.token)).status).toBe(404);
    expect((await head()).markup).toBe(MERGE_BEFORE);
  });

  it('keeps annotation mappings atomic with mixed metadata replacement and records their undo',async()=>{
   const token=await mintToken('mxmx_test_editor_mixed');
   const response=await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:MERGE_BEFORE}}));
   const doc=await response.json();
   await createAnnotationFor({tokenId:token.id,userId:null},doc.id,{nodeId:'b',body:'suffix',quote:'same',range:{v:1,parts:[{rel:'',start:5,end:9,text:'same'}]}},{kind:'human',label:'Tester',transport:'browser'});
   const get=async()=> (await getArtifactRoute(request(`/api/artifacts/${doc.id}`,{token:token.token}),params({ id: doc.id }))).json();
   const head=await get();
   const result=await replaceArtifactRoute(request(`/api/artifacts/${doc.id}`,{method:'PUT',token:token.token,json:{markup:MERGE_AFTER,title:'Retitled',expectedVersion:head.version,expectedState:head.state,annotation_ops:[MERGE_OP]}}),params({ id: doc.id }));
   expect(result.status,await result.clone().text()).toBe(200);
   const changed=await get();expect(changed.title).toBe('Retitled');expect(changed.annotations[0].anchor.key).toBe('a');
   const undone=await editsRoute(request(`/api/artifacts/${doc.id}/edits`,{method:'POST',token:token.token,json:{edit_id:changed.edit_id,source:MERGE_BEFORE,annotation_ops:[{id:MERGE_OP.id,kind:'undo'}]}}),params({ id: doc.id }));
   expect(undone.status,await undone.clone().text()).toBe(200);expect((await get()).annotations[0].anchor.key).toBe('b');
  });
});
