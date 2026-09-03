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
  // CORRECTED BY THE IMPLEMENTER (F3): the artifact GET inlines the open set
  // under `annotations`; `open_annotations` is the write echo's COUNT
  // (lib/artifact-wire.ts, and __tests__/annotations.test.ts:165 pins it as a
  // number). The assertion below is unchanged in strength — the owner read
  // must carry the same quote and range — only the field name is the product's.
  return (await res.json()) as { edit_id: string; markup: string; annotations: Wire[]; open_annotations: number };
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
    const owned = await head(w.t.token, w.doc.id);
    expect(owned.open_annotations).toBe(1); // the echo's count contract, unchanged
    const [inlined] = owned.annotations;
    expect(inlined.quote).toBe(QUOTE);
    expect(inlined.range).toEqual(RANGE);
    expect(inlined.quote_found).toBe(true);
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

/*
 * ADDED BY THE IMPLEMENTER (F3). The seeds cannot see either of these: their
 * fixture's anchored paragraph opens with its `<strong>`, so the element child
 * and the AST child happen to be the same index, and every part of it is
 * separated by real spaces, so a joiner between tags is invisible too.
 */
const RE_ANCHOR_DOC =
  '<p>An intro paragraph here.</p>'
  + '<p>Lead in <strong>Revenue grew</strong> 40% in Q3.</p>'
  + '<p>Costs fell too.</p>';

async function setupWith(markup: string) {
  const t = await mintToken('agent');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const doc = (await res.json()) as { id: string; edit_id: string; version: number };
  return { t, doc, cookie: await agentCookie([t.id]) };
}

describe('resolving a range against the SOURCE', () => {
  it('counts ELEMENT children and ELEMENT siblings — text between the tags is not a step', async () => {
    const w = await setupWith(RE_ANCHOR_DOC);
    // The anchored <p> is `[text "Lead in ", <strong>, text " 40% in Q3."]`:
    // element child 0 is the <strong>, AST child 0 is the text before it.
    const made = await myCreateAnnotationRoute(
      request(`/api/my/artifacts/${w.doc.id}/annotations`, {
        method: 'POST', cookie: w.cookie,
        json: {
          path: '1', edit_id: w.doc.edit_id, body: 'which quarter?',
          quote: 'grew 40% in Q3. Costs fell too.',
          range: {
            v: 1,
            parts: [
              { rel: '0', start: 8, end: 12, text: 'grew' },
              { rel: '', start: 20, end: 32, text: ' 40% in Q3.' },
              { rel: '+1', start: 0, end: 15, text: 'Costs fell too.' },
            ],
          },
        },
      }),
      params({ id: w.doc.id }),
    );
    expect(made.status, await made.clone().text()).toBe(201);
    const [ann] = await list(w.t.token, w.doc.id);
    expect(ann.quote_found).toBe(true);

    // Each address alone, so a wrong step cannot hide behind a right one.
    for (const part of [
      { rel: '0', start: 8, end: 12, text: 'grew' },
      { rel: '+1', start: 0, end: 15, text: 'Costs fell too.' },
    ]) {
      const { edit_id } = await head(w.t.token, w.doc.id);
      const one = await myCreateAnnotationRoute(
        request(`/api/my/artifacts/${w.doc.id}/annotations`, {
          method: 'POST', cookie: w.cookie,
          json: { path: '1', edit_id, body: `only ${part.rel}`, quote: part.text, range: { v: 1, parts: [part] } },
        }),
        params({ id: w.doc.id }),
      );
      expect(one.status, await one.clone().text()).toBe(201);
      expect(((await one.json()) as Wire).quote_found, `rel "${part.rel}" must resolve`).toBe(true);
    }
  });

  it('reads a node the way the DOM does: the text either side of a tag joins with NOTHING', async () => {
    const w = await setupWith('<p>Untouched.</p><p>Total<strong>42</strong>units sold.</p>');
    const made = await myCreateAnnotationRoute(
      request(`/api/my/artifacts/${w.doc.id}/annotations`, {
        method: 'POST', cookie: w.cookie,
        json: {
          path: '1', edit_id: w.doc.edit_id, body: 'is that right?',
          quote: 'Total42units',
          // textContent is "Total42units sold." — a joiner between the tags
          // would read "Total 42 units sold." and never find this.
          range: { v: 1, parts: [{ rel: '', start: 0, end: 12, text: 'Total42units' }] },
        },
      }),
      params({ id: w.doc.id }),
    );
    expect(made.status, await made.clone().text()).toBe(201);
    expect(((await made.json()) as Wire).quote_found).toBe(true);
  });
});

describe('what "found" means', () => {
  /*
   * ADDED BY THE IMPLEMENTER (F3). The seeds only ever remove ALL of a quote,
   * so they cannot say whether one surviving part is enough. It is not: a
   * quote is the words a person selected, and half of them is not those words.
   * The gate leg this phase adds depends on the same reading — it rewords only
   * the first of two paragraphs and expects `quote_found` false.
   */
  it('one part written away is enough to say the quote is gone', async () => {
    const w = await setup();
    expect((await comment(w, { quote: QUOTE, range: RANGE })).status).toBe(201);
    const { edit_id } = await head(w.t.token, w.doc.id);
    const edited = await editsRoute(
      request(`/api/artifacts/${w.doc.id}/edits`, { method: 'POST', token: w.t.token, json: { edit_id, old_string: 'grew</strong>', new_string: 'fell</strong>' } }),
      params({ id: w.doc.id }),
    );
    expect(edited.status, await edited.clone().text()).toBe(200);

    const [ann] = await list(w.t.token, w.doc.id);
    // The second part (" 40% in Q3,") is untouched — and that is not enough.
    expect((await head(w.t.token, w.doc.id)).markup).toContain('40% in Q3,');
    expect(ann.orphaned).toBe(false);
    expect(ann.quote_found).toBe(false);
  });
});
