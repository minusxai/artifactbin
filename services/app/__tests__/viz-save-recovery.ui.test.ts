/**
 * A refused INTERMEDIATE chart state must not swallow the edits that fix it.
 *
 * Rebinding a chart is several picks: the table, then each axis. Between the
 * table pick and the axis picks the document is honestly invalid — the chart
 * still encodes the OLD table's columns — and the authoring door refuses it
 * ("encoding field "revenue" is not a column of query $costs"). That refusal is
 * right. What must not happen is the axis picks that make the chart valid
 * again never reaching the server, leaving the editor on "not saved" with the
 * stored document still bound to the old table.
 *
 * Real handlers throughout: the editor's own HTTP backend and save queue
 * (solid/lib/live-edits-core), with `fetch` dispatched into the real /prepare and /edits
 * routes over this file's PGLite. The only thing the test controls is TIMING —
 * when the refusal comes back relative to the next picks.
 */
import { waitFor } from '@testing-library/dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { request, useAppHarness } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as prepareRoute } from '@/app/api/artifacts/[id]/prepare/route';
import { getArtifactById } from '@/lib/artifacts/store';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { readQuestionChart, updateQuestionChartInJsx } from '@/lib/data/story/story-viz';
import { createLiveEditsCore } from '@/solid/lib/live-edits-core';
import type { DocumentGraph } from '@/lib/story/graph/document-graph';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
/** Helmet is node 0; the Question is the root div's third child. */
const PATH = '1.2';
const spec = (mark: string, x: string, y: string) => ({
  kind: 'vega-lite',
  spec: { mark, encoding: { x: { field: x, type: 'nominal' }, y: { field: y, type: 'quantitative' } } },
});

interface Held { url: string; release: () => void }
let token: string;
let docId: string;
/** Which door answered what, in order: the evidence of WHERE the refusal comes from. */
let answered: Array<{ door: 'prepare' | 'edits'; status: number }>;
/** When set, the next /prepare answer is held until the test releases it. */
let holdNextPrepare: boolean;
let held: Held | null;

async function dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body as string | undefined;
  const route = (path: string) => request(path, { method: 'POST', token, body, headers: { 'content-type': 'application/json' } });
  if (url === `/api/my/artifacts/${docId}/prepare`) {
    const wait = holdNextPrepare ? new Promise<void>((resolve) => { held = { url, release: resolve }; }) : null;
    holdNextPrepare = false;
    const res = await prepareRoute(route(`/api/artifacts/${docId}/prepare`), params(docId));
    if (wait) await wait;
    answered.push({ door: 'prepare', status: res.status });
    return res;
  }
  if (url === `/api/my/artifacts/${docId}/edits`) {
    const res = await editRoute(route(`/api/artifacts/${docId}/edits`), params(docId));
    answered.push({ door: 'edits', status: res.status });
    return res;
  }
  throw new Error(`unexpected request ${url}`);
}

beforeEach(async () => {
  answered = [];
  holdNextPrepare = false;
  held = null;
  token = (await mintToken('viz-save-recovery')).token;
  const make = async (json: unknown) => (await (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json }))).json()).id as string;
  const sales = await make({ title: 'Regional sales', dataset: 'region,revenue\nNorth,4200\nSouth,3100' });
  const costs = await make({ title: 'Monthly costs', dataset: 'month,spend\n2026-01,900\n2026-02,1400' });
  const helmet = `<Helmet>` +
    `<Import name="sales_data" src="ref:${sales}" /><Query name="sales">{\`select * from sales_data.rows\`}</Query>` +
    `<Import name="costs_data" src="ref:${costs}" /><Query name="costs">{\`select * from costs_data.rows\`}</Query></Helmet>`;
  const unbound = helmet + `<div className="p-8"><h1 className="text-3xl">Quarterly review</h1>` +
    `<p>A paragraph that must survive every chart edit.</p><Question title="Revenue" data="$sales" /></div>`;
  const markup = updateQuestionChartInJsx(unbound, PATH, { viz: spec('bar', 'region', 'revenue') as never, table: 'sales' });
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { title: 'Review', markup } }));
  expect(created.status).toBe(201);
  docId = (await created.json()).id;
  vi.stubGlobal('fetch', vi.fn(dispatch));
});

afterEach(() => {
  held?.release();
  vi.unstubAllGlobals();
});

async function openEditor() {
  const row = (await getArtifactById(docId))!;
  if (row.document?.kind !== 'graph') throw new Error('expected a graph document');
  let source = row.source!;
  const core = createLiveEditsCore(() => ({
    backend: createHttpBackend(docId),
    initialEditId: row.edit_id,
    initialVersion: row.version,
    initialDocument: row.document as DocumentGraph,
    initialMetadata: { title: row.title, theme: null, template: null, colorMode: null },
    initialSource: source,
    onRemoteDocument: (next) => { source = next; },
  }));
  const hook = { result: { current: { get state() { return core.getState(); }, queue: core.queue, flushNow: core.flushNow, isIdle: core.isIdle } } };
  /** What the inspector does on a pick: rewrite the Question in the CURRENT source and queue the whole document. */
  const pick = (viz: ReturnType<typeof spec>, table: string) => {
    source = updateQuestionChartInJsx(source, PATH, { viz: viz as never, table });
    hook.result.current.queue({ source });
  };
  return { hook, pick };
}

const stored = async () => readQuestionChart((await getArtifactById(docId))!.source!, PATH);

describe('a refused intermediate chart state', () => {
  it('does not drop the axis picks queued while its refusal was on the wire', async () => {
    const { hook, pick } = await openEditor();

    holdNextPrepare = true;
    pick(spec('line', 'region', 'revenue'), 'costs'); // the table switch alone: invalid
    await waitFor(() => expect(held).not.toBeNull(), { timeout: 5000 }); // flushed on its own, now in flight

    pick(spec('line', 'month', 'revenue'), 'costs'); // x-axis: still invalid
    pick(spec('line', 'month', 'spend'), 'costs');   // y-axis: valid again
    held!.release();

    await waitFor(() => expect(hook.result.current.state.status).toMatch(/not a column of query \$costs|^$/), { timeout: 5000 });
    // The refusal came from the authoring door, not the commit.
    expect(answered[0]).toEqual({ door: 'prepare', status: 400 });

    await waitFor(async () => {
      expect(await stored()).toEqual({ viz: spec('line', 'month', 'spend'), table: 'costs', title: 'Revenue' });
    }, { timeout: 8000, interval: 100 });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: '', pending: false }), { timeout: 5000 });
    expect(hook.result.current.isIdle()).toBe(true);
  });

  it('lets the slow human path — refused on its own, axes picked afterwards — save the fixed chart', async () => {
    const { hook, pick } = await openEditor();

    pick(spec('line', 'region', 'revenue'), 'costs');
    await waitFor(() => expect(hook.result.current.state.status).toContain('encoding field "revenue" is not a column of query $costs'), { timeout: 5000 });
    expect(await stored()).toEqual({ viz: spec('bar', 'region', 'revenue'), table: 'sales', title: 'Revenue' });

    pick(spec('line', 'month', 'revenue'), 'costs');
    pick(spec('line', 'month', 'spend'), 'costs');
    await waitFor(async () => {
      expect(await stored()).toEqual({ viz: spec('line', 'month', 'spend'), table: 'costs', title: 'Revenue' });
    }, { timeout: 8000, interval: 100 });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: '', pending: false }), { timeout: 5000 });
    expect(hook.result.current.isIdle()).toBe(true);
  });

  it('a drain after the refusal still sends the newer work queued behind it', async () => {
    const { hook, pick } = await openEditor();

    holdNextPrepare = true;
    pick(spec('line', 'region', 'revenue'), 'costs');
    await waitFor(() => expect(held).not.toBeNull(), { timeout: 5000 });
    pick(spec('line', 'month', 'spend'), 'costs');
    held!.release();
    // Leaving edit mode (done button, hidden tab) drains everything owed.
    await hook.result.current.flushNow();

    expect(await stored()).toEqual({ viz: spec('line', 'month', 'spend'), table: 'costs', title: 'Revenue' });
    expect(hook.result.current.state.status).toBe('');
  });
});
