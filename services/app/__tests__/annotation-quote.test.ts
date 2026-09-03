/**
 * F3 — a comment keeps the exact selection (SEEDED RED by the orchestrator).
 *
 * The anchor stays one node. Beside it the row keeps the QUOTE (the selected
 * text) and a RANGE addressed relative to the anchor: a hint for repainting the
 * highlight and the text an agent should read, never a second identity. Both are
 * stored verbatim; `quote_found` is computed on every read, like `orphaned`.
 */
import { describe, expect, it } from 'vitest';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { mintToken } from '@/lib/tokens';
import { agentCookie, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const DOC = '<p>An intro paragraph here.</p><p><strong>Revenue grew</strong> 40% in Q3, ahead of plan.</p><p>Costs fell too.</p>';

interface RangePart { rel: string; start: number; end: number; text: string }
interface AnnotationRange { v: 1; parts: RangePart[] }
interface Wire {
  id: string;
  orphaned: boolean;
  anchor: { key: string; path: string } | null;
  snippet: string;
  quote: string | null;
  range: AnnotationRange | null;
  quote_found: boolean | null;
}

async function setup() {
  const t = await mintToken('agent');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const doc = (await res.json()) as { id: string; edit_id: string; version: number };
  return { t, doc, cookie: await agentCookie([t.id]) };
}
const head = async (token: string, id: string) => {
  const res = await getArtifactRoute(request(`/api/artifacts/${id}`, { token }), params({ id }));
  expect(res.status).toBe(200);
  return (await res.json()) as { edit_id: string; markup: string; open_annotations: Wire[] };
};
const list = async (token: string, id: string): Promise<Wire[]> => {
  const res = await listAnnotationsRoute(request(`/api/artifacts/${id}/annotations`, { token }), params({ id }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { annotations?: Wire[] } | Wire[];
  return Array.isArray(body) ? body : body.annotations ?? [];
};
const comment = (w: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown>, editId = w.doc.edit_id) =>
  myCreateAnnotationRoute(
    request(`/api/my/artifacts/${w.doc.id}/annotations`, { method: 'POST', cookie: w.cookie, json: { path: '1', edit_id: editId, body: 'is this right?', ...extra } }),
    params({ id: w.doc.id }),
  );

// A selection from inside the <strong> into the paragraph's own text: two parts,
// the first in child 0 of the anchor, the second in the anchor itself.
const RANGE: AnnotationRange = {
  v: 1,
  parts: [
    { rel: '0', start: 8, end: 12, text: 'grew' },
    { rel: '', start: 12, end: 23, text: ' 40% in Q3,' },
  ],
};
const QUOTE = 'grew 40% in Q3,';

describe('a comment keeps its quote and range', () => {
  it('stores quote and range verbatim and answers them on the wire beside the unchanged snippet', async () => {
    const w = await setup();
    const made = await comment(w, { quote: QUOTE, range: RANGE });
    expect(made.status, await made.clone().text()).toBe(201);

    const [ann] = await list(w.t.token, w.doc.id);
    expect(ann.orphaned).toBe(false);
    expect(ann.quote).toBe(QUOTE);
    expect(ann.range).toEqual(RANGE);
    expect(ann.quote_found).toBe(true);
    // The snippet is still the whole node's text — a different thing, kept.
    expect(ann.snippet).toBe('Revenue grew 40% in Q3, ahead of plan.');

    // The owner read inlines the same fields.
    const [inlined] = (await head(w.t.token, w.doc.id)).open_annotations;
    expect(inlined.quote).toBe(QUOTE);
    expect(inlined.range).toEqual(RANGE);
  });

  it('quote_found follows the document: an edit that removes the words flips it, the anchor stays', async () => {
    const w = await setup();
    expect((await comment(w, { quote: QUOTE, range: RANGE })).status).toBe(201);
    const { edit_id } = await head(w.t.token, w.doc.id);
    const edited = await editsRoute(
      request(`/api/artifacts/${w.doc.id}/edits`, { method: 'POST', token: w.t.token, json: { edit_id, old_string: 'grew</strong> 40% in Q3,', new_string: 'fell</strong> 12% in Q4,' } }),
      params({ id: w.doc.id }),
    );
    expect(edited.status, await edited.clone().text()).toBe(200);

    const [ann] = await list(w.t.token, w.doc.id);
    expect(ann.orphaned).toBe(false);
    expect(ann.quote).toBe(QUOTE); // never recomputed
    expect(ann.range).toEqual(RANGE);
    expect(ann.quote_found).toBe(false);
    expect(ann.snippet).toBe('Revenue fell 12% in Q4, ahead of plan.');
  });

  it('quote_found survives an edit elsewhere, and a whole-document PUT that keeps the anchor', async () => {
    const w = await setup();
    expect((await comment(w, { quote: QUOTE, range: RANGE })).status).toBe(201);
    const { edit_id } = await head(w.t.token, w.doc.id);
    const edited = await editsRoute(
      request(`/api/artifacts/${w.doc.id}/edits`, { method: 'POST', token: w.t.token, json: { edit_id, old_string: 'An intro paragraph here.', new_string: 'A brand new intro, and a second sentence.' } }),
      params({ id: w.doc.id }),
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const [ann] = await list(w.t.token, w.doc.id);
    expect(ann.quote_found).toBe(true);
  });

  it('a quote without a range is accepted; a comment without either is the legacy shape', async () => {
    const w = await setup();
    expect((await comment(w, { quote: 'just the words' })).status).toBe(201);
    const [first] = await list(w.t.token, w.doc.id);
    expect(first.quote).toBe('just the words');
    expect(first.range).toBeNull();
    expect(first.quote_found).toBe(true);

    const { edit_id } = await head(w.t.token, w.doc.id);
    const plain = await myCreateAnnotationRoute(
      request(`/api/my/artifacts/${w.doc.id}/annotations`, { method: 'POST', cookie: w.cookie, json: { path: '2', edit_id, body: 'plain' } }),
      params({ id: w.doc.id }),
    );
    expect(plain.status, await plain.clone().text()).toBe(201);
    const legacy = (await list(w.t.token, w.doc.id)).find((a) => a.snippet === 'Costs fell too.')!;
    expect(legacy.quote).toBeNull();
    expect(legacy.range).toBeNull();
    expect(legacy.quote_found).toBeNull();
  });

  it('a malformed range is refused as bad_range, and the quote is canonicalised and capped', async () => {
    const w = await setup();
    const bad = await comment(w, { quote: QUOTE, range: { v: 1, parts: [{ rel: '0.12', start: 5, end: 2, text: 'x' }] } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('bad_range');
    const absolute = await comment(w, { quote: QUOTE, range: { v: 1, parts: [{ rel: '-1', start: 0, end: 1, text: 'x' }] } });
    expect(absolute.status).toBe(400);
    const empty = await comment(w, { quote: QUOTE, range: { v: 1, parts: [{ rel: '', start: 0, end: 4, text: '' }] } });
    expect(empty.status).toBe(400);

    const made = await comment(w, { quote: '  grew   40%\n in Q3, ' + 'x'.repeat(3000) });
    expect(made.status, await made.clone().text()).toBe(201);
    const [ann] = await list(w.t.token, w.doc.id);
    expect(ann.quote!.startsWith('grew 40% in Q3, xxx')).toBe(true);
    expect(ann.quote!.length).toBeLessThanOrEqual(2000);
  });
});
