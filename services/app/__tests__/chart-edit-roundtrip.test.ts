/**
 * A chart edit surviving the trip to the server and back, through the REAL
 * handlers.
 *
 * The editor writes `viz={{…}}` — an OBJECT-valued attribute serialized by the
 * JSX writer — and posts the whole document on the same `/edits` protocol every
 * other edit uses. Two things there are invisible to a UI test:
 *
 *  - **Canonical form.** The server stores `canonicalizeMarkup(newSource)`. If
 *    the editor's serialization is not already canonical, the row disagrees with
 *    the editor's `source` from the first write on, and every later flush
 *    carries the canonicalization delta — which is exactly the "diff lands far
 *    outside the edited node and swallows the document" failure the tier is
 *    built to avoid. `<GridItem>` and `<Number>` only ever write strings and
 *    numbers, so an object-valued attr is genuinely new ground here.
 *
 *  - **Sanitization.** `viz` carries a nested spec through validate → sanitize
 *    → compile. A sanitizer that dropped unknown nested keys would silently
 *    flatten someone's chart into a table.
 *
 * The second edit matters as much as the first: a single edit followed by a
 * re-read looks fine even when the two forms disagree.
 */
import { storedMarkup } from '@/test/helpers/echo';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';

import { mintToken } from '@/lib/tokens';

import { canonicalizeMarkup } from '@/lib/story/jsx-tier';
import { readQuestionChart, updateQuestionChartInJsx } from '@/lib/data/story/story-viz';
import { request } from '@/__tests__/harness';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const BAR = { kind: 'vega-lite', spec: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } };
const LINE = { kind: 'vega-lite', spec: { mark: 'line', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } };

let token: string;
let datasetId: string;

beforeEach(async () => {
  token = (await mintToken('chart-edit')).token;
  const ds = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { title: 'Sales', dataset: [{ region: 'EU', revenue: 10 }, { region: 'US', revenue: 20 }] } }));
  datasetId = (await ds.json()).id;
});

/**
 * A story with one table-rendering Question over a declared query. The Helmet
 * is top-level node 0, so the Question is `1.1` — the root div's second child.
 */
const PATH = '1.1';
const TABLE = 'rows';
const storySource = () =>
  `<Helmet><Query name="rows">{\`select * from ref_${datasetId}\`}</Query></Helmet>` +
  `<div data-design="tw" className="p-4"><h1 className="text-2xl">Report</h1><Question title="Revenue" data="$rows" /></div>`;

async function createStory() {
  const sent = storySource();
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { title: 'doc', markup: sent } }));
  expect(res.status).toBe(201);
  const wire = (await res.json()) as { id: string; edit_id: string; markup?: string; markup_changed?: boolean };
  // The write skips the echo when it stored the document verbatim, so the
  // canonical source is what we sent — the reasoning an agent does.
  return { ...wire, markup: storedMarkup(wire, sent) };
}

const submit = (id: string, editId: string, newSource: string) =>
  editRoute(request(`/api/artifacts/${id}/edits`, { method: 'POST', token, json: { edit_id: editId, source: newSource } }), params(id));

const readBack = async (id: string) =>
  (await (await getArtifactRoute(request(`/api/artifacts/${id}`, { token }), params(id))).json()) as { markup: string; version: number };

describe('the write-back is already canonical', () => {
  it('canonicalizing a chart edit changes nothing', () => {
    const edited = updateQuestionChartInJsx(storySource(), PATH, { viz: BAR, table: TABLE });
    expect(canonicalizeMarkup(edited)).toBe(edited);
  });
});

describe('a chart edit through /edits', () => {
  it('is stored byte-identically to what the editor sent', async () => {
    const story = await createStory();
    const edited = updateQuestionChartInJsx(story.markup, PATH, { viz: BAR, table: TABLE });
    const res = await submit(story.id, story.edit_id, edited);
    expect(res.status).toBe(200);
    expect((await readBack(story.id)).markup).toBe(edited);
  });

  it('keeps the whole spec — the sanitizer must not flatten a chart', async () => {
    const story = await createStory();
    const res = await submit(story.id, story.edit_id, updateQuestionChartInJsx(story.markup, PATH, { viz: BAR, table: TABLE }));
    expect(res.status).toBe(200);
    const stored = await readBack(story.id);
    expect(readQuestionChart(stored.markup, PATH)).toEqual({ viz: BAR, table: TABLE, title: 'Revenue' });
  });

  it('re-submitting the SAME source is a no-op, not a fresh whole-document splice', async () => {
    // If the stored form differed from the editor's, this would land as a real
    // edit every time — the document rewriting itself on every idle flush.
    const story = await createStory();
    const edited = updateQuestionChartInJsx(story.markup, PATH, { viz: BAR, table: TABLE });
    const first = await submit(story.id, story.edit_id, edited);
    const { edit_id: nextEditId } = await first.json();
    const again = await submit(story.id, nextEditId, edited);
    expect(again.status).toBe(400);
    const body = await again.json();
    expect(body.error).toBe('bad_diff');
    expect(body.detail).toBe('identical');
  });

  it('SECOND edit lands on the first, leaving the document intact', async () => {
    const story = await createStory();
    const one = await submit(story.id, story.edit_id, updateQuestionChartInJsx(story.markup, PATH, { viz: BAR, table: TABLE }));
    const after = await one.json();
    const stored = await readBack(story.id);

    const two = await submit(story.id, after.edit_id, updateQuestionChartInJsx(stored.markup, PATH, { viz: LINE, table: TABLE }));
    expect(two.status).toBe(200);
    const final = await readBack(story.id);
    expect(readQuestionChart(final.markup, PATH)!.viz).toEqual(LINE);
    // The rest of the story is still there — the whole point of a scoped splice.
    expect(final.markup).toMatch(/<h1 className="text-2xl" id="[^"]+">Report<\/h1>/);
    expect(final.markup).toContain('title="Revenue"');
    expect(final.version).toBe(3); // create, edit, edit
  });

  it('clearing the chart back to a table round-trips too', async () => {
    const story = await createStory();
    const one = await submit(story.id, story.edit_id, updateQuestionChartInJsx(story.markup, PATH, { viz: BAR, table: TABLE }));
    const stored = await readBack(story.id);
    const cleared = updateQuestionChartInJsx(stored.markup, PATH, { viz: undefined, table: TABLE });
    expect((await submit(story.id, (await one.json()).edit_id, cleared)).status).toBe(200);
    const final = await readBack(story.id);
    expect(final.markup).not.toContain('viz=');
    expect(final.markup).toContain('data="$rows"');
  });

  it('rebinding to a table the document does not declare is refused', async () => {
    // The picker only offers what the document declares, but the write-back
    // must not be the only thing standing between a typo and an empty chart.
    const story = await createStory();
    const res = await submit(story.id, story.edit_id, updateQuestionChartInJsx(story.markup, PATH, { viz: BAR, table: 'zzzzzz' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Array<{ message: string }> };
    expect(body.error).toBe('invalid_jsx');
    expect(body.details[0].message).toContain('$zzzzzz');
  });
});
