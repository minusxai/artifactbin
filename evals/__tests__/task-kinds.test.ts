/**
 * THE PER-TASK SCORER SEAM.
 *
 * Before this, a task-specific predicate had nowhere to live: the one that
 * existed (`kept_untouched_text`) was a conditional in `main.ts`, its name was
 * hard-coded into a closed enum in `contracts.ts`, and the CI set was
 * enumerated by hand in a test — so three shared files changed for every check
 * a new task wanted. A KIND now owns its check names, its driver-side setup and
 * its product-side checks in one module, and `main.ts` asks the registry.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TaskSchema, type Task } from '../lib/contracts';
import {
  DriverFailure,
  TASK_KINDS,
  checkNamesFor,
  prepareTask,
  runChecks,
  scorerFor,
  type CheckContext,
  type SetupContext,
  type TaskScorer,
} from '../lib/score/kinds';
import { discoverTasks } from '../lib/task-set';

const TASKS_DIR = path.resolve(__dirname, '../tasks');

const task = (over: Partial<Task> = {}): Task =>
  TaskSchema.parse({ id: 't', brief: 'b', checks: ['published'], ...over });

const checkCtx = (over: Partial<CheckContext> = {}): CheckContext => ({
  task: task(),
  productUrl: 'http://product.test',
  startId: 'aaa111',
  token: 'mx_t',
  driverHeaders: { 'x-eval-driver': '1' },
  served: { status: 200, html: '<html><body><p>hello</p></body></html>' },
  record: () => {},
  ...over,
});

const setupCtx = (over: Partial<SetupContext> = {}): SetupContext => ({
  task: task(),
  base: 'http://proxy.test',
  id: 'aaa111',
  token: 'mx_t',
  driverHeaders: { 'x-eval-driver': '1' },
  log: () => {},
  ...over,
});

describe('the registry', () => {
  it('has a scorer for every kind, and every kind names itself', () => {
    for (const kind of TASK_KINDS) expect(scorerFor(kind).kind).toBe(kind);
  });

  it('refuses an unknown kind, naming the ones that exist', () => {
    expect(() => scorerFor('nope')).toThrow(/unknown task kind "nope".*publish/);
  });

  it('an unknown kind is refused at LOAD, before an agent minute is spent', () => {
    expect(() => task({ kind: 'nope' } as unknown as Partial<Task>)).toThrow();
  });

  it('`publish` is the default — every task that declares no kind is one', () => {
    expect(task().kind).toBe('publish');
    for (const found of discoverTasks(TASKS_DIR)) {
      expect(TASK_KINDS).toContain(found.task.kind);
    }
  });

  it('a task may only list checks its own kind can answer', () => {
    // `responded` belongs to the comment kind; a publish task listing it would
    // be gated on a check nothing computes, which `verdictFor` fails.
    expect(() => task({ checks: ['published', 'responded'] as Task['checks'] })).toThrow(/responded.*is not one a publish task can answer/);
    expect(checkNamesFor('comment')).toEqual(expect.arrayContaining(['responded', 'changed', 'resolved', 'urls_kept', 'assets_served', 'assets_ok']));
    expect(checkNamesFor('publish')).toContain('kept_untouched_text');
  });
});

describe('the `publish` kind reproduces today\'s behaviour', () => {
  const publish = scorerFor('publish');

  it('scores kept_untouched_text off the served document, exactly as the conditional did', async () => {
    const html = '<html><body><p>median first response of 3 hours</p></body></html>';
    expect(await publish.checks(checkCtx({ task: task({ seedKeepText: 'median first response of 3 hours' }), served: { status: 200, html } }))).toEqual({
      kept_untouched_text: true,
    });
    expect(await publish.checks(checkCtx({ task: task({ seedKeepText: 'gone' }), served: { status: 200, html } }))).toEqual({
      kept_untouched_text: false,
    });
  });

  it('answers null — never false — for a task that seeds nothing', async () => {
    expect(await publish.checks(checkCtx())).toEqual({ kept_untouched_text: null });
  });

  it('prepares nothing: a publish task\'s setup makes no call at all', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await publish.setup(setupCtx());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('prepareTask — setup runs BEFORE the baseline is read', () => {
  /**
   * The order is the whole point. A `comment` task's setup posts a comment, and
   * the anchor stamp is a REAL edit that bumps the version and rewrites the
   * markup — so a baseline read before it would make `published` true for a
   * document the agent never touched.
   */
  const scorer = (setup: TaskScorer['setup']): TaskScorer => ({
    kind: 'publish',
    checkNames: [],
    setup,
    checks: async () => ({}),
  });

  it('runs setup, then reads the baseline, and hands the baseline back', async () => {
    const seen: string[] = [];
    const prepared = await prepareTask(
      scorer(async () => { seen.push('setup'); }),
      setupCtx(),
      async () => { seen.push('baseline'); return { status: 200, html: '<p>waiting</p>' }; },
    );
    expect(seen).toEqual(['setup', 'baseline']);
    expect(prepared).toEqual({ ok: true, baseline: { status: 200, html: '<p>waiting</p>' } });
  });

  it('names the STEP that failed and never reads the baseline — a setup failure is not an agent failure', async () => {
    const readBaseline = vi.fn();
    const prepared = await prepareTask(
      scorer(async () => { throw new DriverFailure('comment', 'commenting on aaa111 → 400 bad_path'); }),
      setupCtx(),
      readBaseline as unknown as () => Promise<{ status: number; html: string }>,
    );
    expect(prepared).toEqual({ ok: false, step: 'comment', error: 'commenting on aaa111 → 400 bad_path' });
    expect(readBaseline).not.toHaveBeenCalled();
  });

  it('an unlabelled throw still fails as SETUP rather than as the agent', async () => {
    const prepared = await prepareTask(scorer(async () => { throw new Error('ECONNREFUSED'); }), setupCtx(), async () => ({ status: 200, html: '' }));
    expect(prepared).toMatchObject({ ok: false, step: 'setup', error: 'ECONNREFUSED' });
  });
});

describe('the `comment` kind', () => {
  const comment = scorerFor('comment');

  it('gates responded/changed/resolved and reports the byte-exact split beside them', async () => {
    const rows: Array<[string, unknown]> = [];
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'comment-split.html'), 'utf8');
    const t = TaskSchema.parse(JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'comment.json'), 'utf8')));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      annotations: [{ status: 'resolved', thread: [
        { author: { kind: 'human', label: null, transport: 'browser' } },
        { author: { kind: 'agent', label: 'Claude Code', transport: 'http' } },
      ] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const out = await comment.checks(checkCtx({ task: t, served: { status: 200, html }, record: (m, v) => rows.push([m, v]) }));

    // The kind answers every name it OWNS. A task that asked for no pictures gets
    // null for the three asset checks — never false — and `checksToRecord` drops an
    // ungated null rather than printing a red FAIL for something inapplicable.
    expect(out).toEqual({ responded: true, changed: true, resolved: true, urls_kept: null, assets_served: null, assets_ok: null });
    expect(rows).toEqual(expect.arrayContaining([['answered_by', 'Claude Code (http)'], ['split_verbatim', true]]));
    // The thread is read from the document the agent was GIVEN, with `status=all`:
    // a resolved thread has left the artifact GET, and an agent that published
    // somewhere else has not answered the comment.
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://product.test/api/artifacts/aaa111/annotations?status=all');
    fetchSpy.mockRestore();
  });

  it('is refused at load without the comment it posts', () => {
    const base = { id: 'c', kind: 'comment', handoff: 'token', brief: 'b', seed: '<p>a</p>', checks: ['published'] };
    expect(() => TaskSchema.parse(base)).toThrow(/comment/);
    expect(() => TaskSchema.parse({ ...base, comment: { path: '1', body: 'split it' } })).not.toThrow();
  });

  /**
   * A kind's `validate` refuses a task that grades itself on something it has not
   * declared — at LOAD, before a run mints anything or spends an agent minute. It
   * asks that of the CHECKS the task lists, never of the kind as a whole: the image
   * variant splits no paragraph and the split variant names no picture, and each
   * must be free of the other's data.
   */
  it('wants the paragraph `changed` grades — and only from the task that grades it', () => {
    const base = { id: 'c', kind: 'comment', handoff: 'token', brief: 'b', seed: '<p>a</p>', comment: { path: '1', body: 'split it' } };
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'changed'] })).toThrow(/seedSplitText/);
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'changed'], seedSplitText: 'x' })).not.toThrow();
    expect(() => TaskSchema.parse({ ...base, checks: ['published'] })).not.toThrow();
  });

  it('wants the URLs the asset checks grade, and refuses one the comment never asked for', () => {
    const url = 'https://example.test/a.svg';
    const base = {
      id: 'c', kind: 'comment', handoff: 'token', brief: 'b', seed: '<p>a</p>',
      comment: { path: '1', body: `add ${url} please` },
    };
    // Gating an asset check with nothing to grade would fail every run.
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'urls_kept'] })).toThrow(/assetUrls/);
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'assets_served'] })).toThrow(/assetUrls/);
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'assets_ok'] })).toThrow(/assetUrls/);
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'urls_kept'], assetUrls: [url] })).not.toThrow();
    // …and the URL the scorer grades must be the URL the agent was ASKED for: two
    // copies of a string in one file is exactly where drift starts.
    expect(() => TaskSchema.parse({ ...base, checks: ['published', 'urls_kept'], assetUrls: ['https://example.test/b.svg'] }))
      .toThrow(/comment/);
  });

  it('the image variant on disk parses, and grades the three asset checks', () => {
    const t = TaskSchema.parse(JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'comment-image.eval.json'), 'utf8')));
    expect(t.kind).toBe('comment');
    expect(t.assetUrls).toHaveLength(2);
    expect(t.checks).toEqual(expect.arrayContaining(['urls_kept', 'assets_served', 'assets_ok']));
    for (const url of t.assetUrls ?? []) expect(t.comment?.body).toContain(url);
  });

  it('needs the token handoff — the driver must hold a credential to comment at all', () => {
    const t = { id: 'c', kind: 'comment', brief: 'b', comment: { path: '1', body: 'x' }, seedSplitText: 'y', seed: '<p>a</p>', checks: ['published'] };
    expect(() => TaskSchema.parse(t)).toThrow(/handoff/);
  });
});

describe('runChecks — a failed driver READ is not an agent failure either', () => {
  /**
   * The reviewer's F2, and the same lesson `setup_ok` learned one step earlier:
   * `readThreads` used to answer `[]` for a 500, an expired token or a socket
   * error, which scores `responded:false, resolved:false` and reports an agent
   * that ignored the comment. The kind's own checks are UNANSWERED (null) and
   * the driver says so with `checks_ok`.
   */
  const scorer = (checks: TaskScorer['checks']): TaskScorer => ({
    kind: 'comment', checkNames: ['responded', 'changed', 'resolved'], setup: async () => {}, checks,
  });

  it('passes the checks through when the read worked', async () => {
    const out = await runChecks(scorer(async () => ({ responded: true, changed: false, resolved: true })), checkCtx());
    expect(out).toEqual({ ok: true, checks: { responded: true, changed: false, resolved: true } });
  });

  it('names the step, answers every one of the kind\'s checks NULL, and says which to stop gating', async () => {
    const out = await runChecks(scorer(async () => { throw new DriverFailure('reading the thread', 'GET …/annotations?status=all → 500'); }), checkCtx());
    expect(out).toEqual({
      ok: false,
      step: 'reading the thread',
      error: 'GET …/annotations?status=all → 500',
      checks: { responded: null, changed: null, resolved: null },
      ungated: ['responded', 'changed', 'resolved'],
    });
  });

  it('an unlabelled throw is still the DRIVER\'s, named `checks`', async () => {
    const out = await runChecks(scorer(async () => { throw new Error('fetch failed'); }), checkCtx());
    expect(out).toMatchObject({ ok: false, step: 'checks', error: 'fetch failed' });
  });

  it('the comment kind THROWS on a failed thread read rather than reading it as silence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const t = TaskSchema.parse(JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'comment.json'), 'utf8')));
    const out = await runChecks(scorerFor('comment'), checkCtx({ task: t }));
    expect(out).toMatchObject({ ok: false, step: 'reading the thread' });
    fetchSpy.mockRestore();
  });
});
