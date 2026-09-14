import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TaskSchema, type Task } from '../lib/contracts';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { parseMutationRequest } from '@/lib/story/mutation-request';
import type { DataflowState, Row } from '@/lib/story/dataflow';
import {
  DriverFailure,
  checkNamesFor,
  runChecks,
  scorerFor,
  type CheckContext,
} from '../lib/score/kinds';
import { completionMutation, islandOf, rowMarkedDone } from '../lib/score/kinds/tracker';

/**
 * THE `tracker` KIND — the first eval task that grades the product's
 * INTERACTIVE half: a writable dataset, a dataset-backed `<Mutation>`, a
 * row-keyed repeat template, and — the only one of the four that cannot be
 * read off the document — a write that actually LANDS.
 *
 * The island fixtures below are built with the PRODUCT's own parser
 * (`parseJsx` + `splitHelmet`), never hand-written: the island carries
 * `split.body` and the Helmet's declarations verbatim
 * (lib/story/prepare-runtime.server), so a fixture assembled any other way
 * would be grading a shape the product does not actually serve — the mistake
 * `dataflowRows` records having made once already.
 */

const TASKS_DIR = path.resolve(__dirname, '../tasks');
const DOC = 'doc123';
const DATASET = 'ds4567';

const island = (markup: string, opts: { state?: DataflowState; mutateUrl?: string | null } = {}) => {
  const parsed = parseJsx(markup);
  if (!parsed.ok) throw new Error(`fixture markup does not parse: ${parsed.error}`);
  const { content, body } = splitHelmet(parsed.nodes);
  const flow = {
    values: content.values,
    queries: content.queries,
    ...(content.mutations.length ? { mutations: content.mutations } : {}),
  };
  const mutateUrl = opts.mutateUrl === undefined ? (content.mutations.length ? `/a/${DOC}/mutate` : null) : opts.mutateUrl;
  const data = {
    nodes: body,
    ...(mutateUrl ? { mutateUrl } : {}),
    dataflow: { flow, ...(opts.state ? { state: opts.state } : {}) },
  };
  return `<html><head><title>Team tracker, week 38</title></head><body><div id="mx-story-root"></div>` +
    `<script type="application/json" id="mx-story-data">${JSON.stringify(data)}</script></body></html>`;
};

/** A document shaped the way the task asks for one: a keyed table, a row action, an add form. */
const TRACKER_MARKUP = `<Helmet>
<title>Team tracker, week 38</title>
<Value name="new_title" type="string" />
<Value name="new_owner" type="string" />
<Query name="tasks" source="ref:${DATASET}">{\`select id, title, owner, status from public.rows order by id\`}</Query>
<Query name="counts" source="ref:${DATASET}">{\`select status, count(*) as tasks from public.rows group by 1\`}</Query>
<Mutation name="complete" source="ref:${DATASET}">{\`update public.rows set status = 'done' where id = $_row.id\`}</Mutation>
<Mutation name="add" source="ref:${DATASET}">{\`insert into public.rows (id, title, owner, status) values (uuid(), $new_title, $new_owner, 'todo')\`}</Mutation>
</Helmet>
<h1>Team tracker, week 38</h1>
<Question data="$counts" viz={{"kind":"table"}} />
<DataTable data="$tasks" rowKey="id">
<Column col="title" />
<Column col="owner" />
<Column col="status"><Button run="$complete">Done</Button></Column>
</DataTable>
<Button run="$add">Add task</Button>`;

const ROWS: Row[] = [
  { id: 1, title: 'Fix login redirect loop', owner: 'Dana', status: 'doing' },
  { id: 2, title: 'Ship weekly digest email', owner: 'Ravi', status: 'todo' },
];

const state = (rows: Row[] = ROWS): DataflowState => ({
  values: {},
  errors: {},
  tables: {
    tasks: { rows, columns: [{ name: 'id', type: 'number' }, { name: 'title', type: 'string' }, { name: 'owner', type: 'string' }, { name: 'status', type: 'string' }] },
  },
});

const checkCtx = (over: Partial<CheckContext> = {}): CheckContext => ({
  task: TaskSchema.parse({ id: 'tracker', kind: 'tracker', brief: 'b', files: { 'tasks.csv': 'id\n1\n' }, checks: ['published'] }),
  productUrl: 'http://product.test',
  startId: 'start1',
  token: 'mx_driver',
  driverHeaders: { 'x-eval-driver': '1' },
  served: { status: 200, html: island(TRACKER_MARKUP, { state: state() }) },
  record: () => {},
  ...over,
});

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The product's two doors, faked: the dataset read (before/after) and the document's write. */
const fakeWire = (opts: { before: Row[]; after: Row[]; mutate: Response | (() => Response) }) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let reads = 0;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.endsWith('/mutate')) return typeof opts.mutate === 'function' ? opts.mutate() : opts.mutate;
    reads += 1;
    return jsonRes({ id: DATASET, format: 'dataset', access: 'readwrite', rows: reads === 1 ? opts.before : opts.after });
  }) as typeof fetch);
  return { calls, spy };
};

const tracker = () => scorerFor('tracker');

describe('the kind registry knows the tracker kind', () => {
  it('answers its four check names', () => {
    expect(tracker().kind).toBe('tracker');
    expect(checkNamesFor('tracker')).toEqual(
      expect.arrayContaining(['uses_row_template', 'declares_mutation', 'mutation_works', 'no_iframe']),
    );
  });

  it('refuses a tracker task that stages no file for the agent to publish', () => {
    const base = { id: 't', kind: 'tracker', brief: 'b', checks: ['published'] };
    expect(() => TaskSchema.parse(base)).toThrow(/file/i);
    expect(TaskSchema.parse({ ...base, files: { 'tasks.csv': 'id\n1\n' } })).toMatchObject({ kind: 'tracker' });
  });
});

describe('the three checks read off the published document', () => {
  it('sees a keyed DataTable, a dataset-backed Mutation and no Iframe', async () => {
    const { spy } = fakeWire({ before: ROWS, after: ROWS, mutate: jsonRes({ error: 'unknown_mutation' }, 400) });
    const out = await tracker().checks(checkCtx());
    spy.mockRestore();
    expect(out).toMatchObject({ uses_row_template: true, declares_mutation: true, no_iframe: true });
  });

  it('sees a keyed For as a row template too', async () => {
    const markup = TRACKER_MARKUP.replace(
      /<DataTable[\s\S]*?<\/DataTable>/,
      '<For each={$tasks} keyBy="id"><p>{$_row.title}</p><Button run="$complete">Done</Button></For>',
    );
    const { spy } = fakeWire({ before: ROWS, after: ROWS, mutate: jsonRes({ error: 'unknown_mutation' }, 400) });
    const out = await tracker().checks(checkCtx({ served: { status: 200, html: island(markup, { state: state() }) } }));
    spy.mockRestore();
    expect(out.uses_row_template).toBe(true);
  });

  it('refuses an unkeyed repeat, a local-only Mutation and an Iframe', async () => {
    const markup = `<Helmet>
<Value name="tasks" type="table" value={[{"id": 1, "status": "todo"}]} />
<Mutation name="complete">{\`update tasks set status = 'done' where id = $_row.id\`}</Mutation>
</Helmet>
<Iframe src="https://example.test/board" height="400px" />
<For each={$tasks}><p>{$_row.status}</p></For>`;
    const out = await tracker().checks(checkCtx({ served: { status: 200, html: island(markup, { state: state() }) } }));
    expect(out).toMatchObject({ uses_row_template: false, declares_mutation: false, no_iframe: false, mutation_works: false });
  });

  it('answers false for a document that carries no story island at all', async () => {
    const rows: Array<[string, unknown]> = [];
    const out = await tracker().checks(checkCtx({
      served: { status: 404, html: '' },
      record: (m, v) => rows.push([m, v]),
    }));
    expect(out).toEqual({ uses_row_template: false, declares_mutation: false, mutation_works: false, no_iframe: false });
    expect(String(rows.find(([m]) => m === 'mutation_probe')?.[1])).toMatch(/island/i);
  });
});

describe('mutation_works — the driver runs the write itself', () => {
  it('binds a row, posts the document\'s own mutate door, and sees the status change', async () => {
    const after: Row[] = [{ ...ROWS[0] }, { ...ROWS[1], status: 'done' }];
    const { calls, spy } = fakeWire({
      before: ROWS,
      after,
      mutate: jsonRes({ ok: true, dataset: DATASET, affected: 1, rowCount: 2 }),
    });
    const rows: Array<[string, unknown]> = [];
    const out = await tracker().checks(checkCtx({ record: (m, v) => rows.push([m, v]) }));
    spy.mockRestore();

    expect(out.mutation_works).toBe(true);
    // The READER's door, on the document the island names — the owner's
    // `/api/artifacts/<id>/mutate` cannot carry the row snapshot a row action needs.
    const write = calls.find((c) => c.url.endsWith('/mutate'));
    expect(write?.url).toBe(`http://product.test/a/${DOC}/mutate`);
    const body = JSON.parse(String(write?.init?.body));
    expect(body.mutation).toBe('complete');
    // A `$_row` mutation is sent WITH the row it was declared over, and that row is
    // one of the query result rows the island carries — `rowSchemas` compares it field by field.
    expect(body.row).toEqual(ROWS[1]);
    expect(String((write?.init?.headers as Record<string, string>).authorization)).toContain('mx_driver');
    // …and the body is a shape the PRODUCT's own door parser accepts, asked of that
    // parser rather than of this test's belief about it (`lib/story/mutation-request`).
    expect(parseMutationRequest(body)).toEqual({ mutation: 'complete', values: {}, row: ROWS[1] });
    // The dataset is re-read after the write, and the probe says what it saw.
    expect(calls.filter((c) => c.url.includes('/api/artifacts/'))).toHaveLength(2);
    expect(String(rows.find(([m]) => m === 'mutation_probe')?.[1])).toMatch(/complete.*todo.*done/i);
  });

  it('is false — with the refusal in the probe row — when the door refuses the write', async () => {
    const { spy } = fakeWire({
      before: ROWS,
      after: ROWS,
      mutate: jsonRes({ error: 'dataset_read_only', detail: 'You need edit access to a writable dataset to make this change.' }, 403),
    });
    const rows: Array<[string, unknown]> = [];
    const out = await tracker().checks(checkCtx({ record: (m, v) => rows.push([m, v]) }));
    spy.mockRestore();
    expect(out.mutation_works).toBe(false);
    expect(String(rows.find(([m]) => m === 'mutation_probe')?.[1])).toMatch(/dataset_read_only/);
  });

  it('is false when the write answers 200 but no row actually changed', async () => {
    const { spy } = fakeWire({ before: ROWS, after: ROWS, mutate: jsonRes({ ok: true, affected: 0 }) });
    const rows: Array<[string, unknown]> = [];
    const out = await tracker().checks(checkCtx({ record: (m, v) => rows.push([m, v]) }));
    spy.mockRestore();
    expect(out.mutation_works).toBe(false);
    expect(String(rows.find(([m]) => m === 'mutation_probe')?.[1])).toMatch(/unchanged|no row/i);
  });

  it('is false, and says so, for a document that declares only a local mutation', async () => {
    const markup = `<Helmet>
<Value name="tasks" type="table" value={[{"id": 1, "status": "todo"}]} />
<Mutation name="complete">{\`update tasks set status = 'done' where id = $_row.id\`}</Mutation>
</Helmet>
<For each={$tasks} keyBy="id"><Button run="$complete">Done</Button></For>`;
    const rows: Array<[string, unknown]> = [];
    const out = await tracker().checks(checkCtx({
      served: { status: 200, html: island(markup, { state: state() }) },
      record: (m, v) => rows.push([m, v]),
    }));
    expect(out.mutation_works).toBe(false);
    expect(String(rows.find(([m]) => m === 'mutation_probe')?.[1])).toMatch(/local/i);
  });

  /**
   * The distinction `checks_ok` exists for: a dataset read that THROWS is our
   * instrument, not the agent's answer — every one of the kind's checks goes
   * unanswered and stops gating, rather than reporting an agent whose tracker
   * did not work.
   */
  it('a failed driver READ is the driver\'s failure, not the agent\'s', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    const checked = await runChecks(tracker(), checkCtx());
    spy.mockRestore();
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.step).toMatch(/dataset/i);
      expect(checked.ungated).toEqual(expect.arrayContaining(['mutation_works']));
      expect(checked.checks.mutation_works).toBeNull();
    }
  });

  it('DriverFailure is what a thrown read produces', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    await expect(tracker().checks(checkCtx())).rejects.toBeInstanceOf(DriverFailure);
    spy.mockRestore();
  });
});

describe('the pure halves the probe is built from', () => {
  it('picks the completing mutation over the inserting one, and never a local one', () => {
    const flow = islandOf(island(TRACKER_MARKUP, { state: state() }))?.dataflow?.flow;
    expect(completionMutation(flow?.mutations ?? [])?.name).toBe('complete');
    expect(completionMutation([])).toBeNull();
  });

  it('reads a row\'s status changing to a done value, and nothing less', () => {
    expect(rowMarkedDone(ROWS, [{ ...ROWS[0] }, { ...ROWS[1], status: 'done' }]).ok).toBe(true);
    expect(rowMarkedDone(ROWS, ROWS).ok).toBe(false);
    // A row that moved the other way is not a completion.
    expect(rowMarkedDone([{ id: 1, status: 'done' }], [{ id: 1, status: 'todo' }]).ok).toBe(false);
    // An INSERT is not a status change either — the probe is about completing a task.
    expect(rowMarkedDone(ROWS, [...ROWS, { id: 3, title: 'New', owner: 'Dana', status: 'todo' }]).ok).toBe(false);
  });
});

describe('the tracker task on disk', () => {
  const task: Task = TaskSchema.parse(JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'tracker.eval.json'), 'utf8')));

  it('is a tracker-kind comparison task that runs after scrolly', () => {
    expect(task.id).toBe('tracker');
    expect(task.kind).toBe('tracker');
    expect(task.order).toBeGreaterThan(4);
    expect(fs.existsSync(path.join(TASKS_DIR, 'tracker.eval.json'))).toBe(true);
  });

  it('gates the common checks the dashboard task lists, plus its own four', () => {
    expect(task.checks).toEqual(expect.arrayContaining([
      'published', 'used_cli', 'used_start_document', 'dataset_created', 'query_ran', 'has_title',
      'no_console_errors', 'no_failed_responses', 'no_local_checkout_reads',
      'uses_row_template', 'declares_mutation', 'mutation_works', 'no_iframe',
    ]));
  });

  it('stages a tasks.csv of 12–16 rows, four owners, Sep 2026 due dates', () => {
    const csv = task.files?.['tasks.csv'] ?? '';
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('id,title,owner,status,due');
    const rows = lines.slice(1).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.length).toBeLessThanOrEqual(16);
    expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r[2])).size).toBe(4);
    for (const r of rows) {
      expect(['todo', 'doing', 'done']).toContain(r[3]);
      expect(r[4]).toMatch(/^2026-09-\d\d$/);
    }
    // Something must be left to complete, or the driver's probe has nothing to watch change.
    expect(rows.filter((r) => r[3] !== 'done').length).toBeGreaterThan(0);
  });

  it('asks for the writable dataset, the title, the row action and the live counts', () => {
    expect(task.brief).toContain('tasks.csv');
    expect(task.brief).toContain('Team tracker, week 38');
    expect(task.brief).toMatch(/readwrite/);
    expect(task.brief).toMatch(/add a task/i);
    expect(task.brief).toMatch(/URL and nothing else/);
  });
});
