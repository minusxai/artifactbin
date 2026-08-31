/**
 * The documents that were already published when canonical form changed.
 *
 * `canonicalizeMarkup` now also rewrites a `<p>` holding block content into a
 * `<div>` (lib/story/nesting.ts). Documents written before that are stored the
 * old way, and the read path fixes them at serve time — but their FIRST edit is
 * the interesting case, because the edit protocol derives a splice by diffing
 * the canonical form of what the agent sends against a base reconstructed from
 * rows written under the OLD canonical form.
 *
 * What must hold: the write applies (not a `bad_diff`, not a CAS miss), the
 * stored row comes out canonical, and the document is not corrupted. What is
 * ACCEPTED: that one write's splice can be wide — the tag change sits at both
 * ends of the element, so a prefix/suffix diff spans it — which costs a
 * concurrent editor inside that element one conflict, once, ever.
 */
import { storedMarkup } from '@/test/helpers/echo';
import { describe, expect, it } from 'vitest';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';


import { buildStoryDocument } from '@/lib/story/document';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

/** The shape as it is STORED on production today — a `<p>` holding divs. */
const LEGACY =
  '<div className="mx-root"><header className="mx-auto max-w-6xl">'
  + '<h1 className="text-5xl">Built something cool?</h1>'
  + '<p className="mx-auto mt-7 max-w-2xl text-justify"><div className="text-base">First para.</div>'
  + '<div className="text-base">Second para.</div></p></header></div>';

/**
 * A row as the old code left it: published normally, then its stored source
 * put back to the non-canonical form. The edit log's genesis row is rewritten
 * with it, which is what `reconstructBaseSource` reads.
 */
async function legacyRow(): Promise<{ id: string; token: string; editId: string }> {
  const mintRes = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 't' }, headers: { 'x-shared-secret': 'test-secret' } }));
  const { token } = await mintRes.json();
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { title: 'legacy', markup: LEGACY } }));
  expect(created.status).toBe(201);
  const doc = await created.json();

  const db = await harness.db();
  await db.query('UPDATE artifacts SET source = $1 WHERE id = $2', [LEGACY, doc.id]);
  await db.query('UPDATE artifact_edits SET inserted = $1 WHERE artifact_id = $2', [LEGACY, doc.id]);
  return { id: doc.id, token, editId: doc.edit_id };
}

describe('a document stored before the nesting rule existed', () => {
  it('is stored the old way, and still SERVES the fixed tree', async () => {
    const { id } = await legacyRow();
    const db = await harness.db();
    const { rows } = await db.query<{ source: string }>('SELECT source FROM artifacts WHERE id = $1', [id]);
    // Precondition: the fixture really is non-canonical, or this file proves nothing.
    expect(rows[0].source).toContain('<p className="mx-auto mt-7 max-w-2xl text-justify">');

    const html = await buildStoryDocument({
      source: rows[0].source, compiledCss: null, theme: null, colorMode: null,
      refData: {}, title: 'legacy', runtimeSrc: '/story/entry-X.js',
    });
    expect(html).not.toMatch(/<p[^>]*class="[^"]*text-justify/);
    expect(html).toMatch(/<div[^>]*class="[^"]*text-justify/);
  });

  it('takes an edit cleanly, and comes out canonical', async () => {
    const { id, token, editId } = await legacyRow();
    const next = LEGACY.replace('First para.', 'First paragraph, edited.');
    const res = await editRoute(
      request(`/api/artifacts/${id}/edits`, { method: 'POST', token: token, json: { edit_id: editId, source: next } }),
      params({ id }),
    );
    expect(res.status).toBe(200);

    const got = await (await getArtifactRoute(request(`/api/artifacts/${id}`, { token: token }), params({ id }))).json();
    expect(got.markup).toContain('First paragraph, edited.');
    expect(got.markup).toContain('Second para.');
    // The write is what migrates the row: canonical from here on.
    expect(got.markup).not.toContain('<p className="mx-auto mt-7 max-w-2xl text-justify">');
    expect(got.markup).toContain('<div className="mx-auto mt-7 max-w-2xl text-justify">');
    expect(got.markup).toContain('<h1 className="text-5xl">Built something cool?</h1>');
  });

  it('a second edit is ordinary — the migration is not paid twice', async () => {
    const { id, token, editId } = await legacyRow();
    const first = await editRoute(
      request(`/api/artifacts/${id}/edits`, { method: 'POST', token: token, json: { edit_id: editId, source: LEGACY.replace('First para.', 'One.') } }),
      params({ id }),
    );
    expect(first.status).toBe(200);
    const afterFirst = await first.json();

    const res = await editRoute(
      request(`/api/artifacts/${id}/edits`, { method: 'POST', token: token, json: { edit_id: afterFirst.edit_id, source: (afterFirst.markup as string).replace('Second para.', 'Two.') } }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.markup).toContain('One.');
    expect(out.markup).toContain('Two.');
  });

  it('an agent that INTRODUCES the fault into a clean document has it fixed too', async () => {
    /*
     * Not only a migration. The rule has to hold on every write for as long as
     * agents write markup — otherwise the next document is the last one's bug.
     */
    const mintRes = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 't' }, headers: { 'x-shared-secret': 'test-secret' } }));
    const { token } = await mintRes.json();
    const clean = '<div className="wrap"><h1>T</h1><p>Only words here.</p></div>';
    const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { title: 'clean', markup: clean } }));
    const doc = await created.json();
    // Clean markup needs no rewriting — the write states that rather than echoing.
    expect(doc.markup_changed).toBe(false);
    expect(storedMarkup(doc, clean)).toBe(clean);

    const res = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, source: clean.replace('<p>Only words here.</p>', '<p className="lede"><div>Now a block.</div></p>') } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.markup).toContain('<div className="lede"><div>Now a block.</div></div>');
    expect(out.markup).not.toContain('<p className="lede">');
    // The rest of the document is untouched by the rewrite.
    expect(out.markup).toContain('<h1>T</h1>');
  });

  it('a narrow edit elsewhere in the document still applies', async () => {
    // The heading is outside the rewritten element entirely, so the migration
    // must not turn an unrelated edit into a whole-document conflict.
    const { id, token, editId } = await legacyRow();
    const res = await editRoute(
      request(`/api/artifacts/${id}/edits`, { method: 'POST', token: token, json: { edit_id: editId, old_string: 'Built something cool?', new_string: 'Built something great?' } }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.markup).toContain('Built something great?');
    expect(out.markup).toContain('First para.');
    // …and it migrates the row too: the old_string/new_string form splices the
    // stored text, but the accepted result is re-canonicalized before it lands,
    // so one write of any kind is enough to retire the fault permanently.
    expect(out.markup).toContain('<div className="mx-auto mt-7 max-w-2xl text-justify">');
    expect(out.markup).not.toContain('<p className="mx-auto mt-7 max-w-2xl text-justify">');
  });
});
