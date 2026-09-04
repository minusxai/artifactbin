/**
 * WHICH tasks run WHERE is decided by the filename, the way minusx marks its
 * measured flows `*.eval.spec.ts`:
 *
 *   tasks/<id>.eval.json — the QA eval set: a column of the comparison report,
 *                          and it runs in CI too (it is still a flow)
 *   tasks/<id>.json      — CI only: a flow that guards the product, never a
 *                          report column (it spends money per LEG, and a matrix
 *                          of six legs should not pay for a product regression
 *                          test that has one right answer)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { discoverTasks, parseShard, selectTasks, shardTasks } from '../lib/task-set';

const DIR = path.resolve(__dirname, '../tasks');

/**
 * The sets, read off DISK rather than typed out here. A hand-written list is a
 * third file to edit for every task added — `comment` turned two tests red that
 * had nothing to do with it — and it tests the list against itself: the
 * filename IS the membership rule, so the test's job is that `selectTasks`
 * obeys it, not that somebody remembered to update an array.
 */
const filesIn = (set: 'ci' | 'eval') =>
  fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && f.endsWith('.eval.json') === (set === 'eval'))
    .map((f) => f.replace(/\.eval\.json$|\.json$/, ''))
    .sort();

describe('discoverTasks', () => {
  it('reads the id and the set membership out of each filename', () => {
    const found = discoverTasks(DIR);
    const byId = Object.fromEntries(found.map((t) => [t.id, t]));
    expect(byId.scrolly).toMatchObject({ id: 'scrolly', inEvalSet: true });
    expect(byId.report).toMatchObject({ id: 'report', inEvalSet: true });
    expect(byId.deck).toMatchObject({ id: 'deck', inEvalSet: true });
    expect(byId.dashboard).toMatchObject({ id: 'dashboard', inEvalSet: true });
    // Joined the comparison set by EXISTING, under its `.eval.json` name — no list to update.
    expect(byId['comment-image']).toMatchObject({ id: 'comment-image', inEvalSet: true });
    expect(byId.data).toMatchObject({ id: 'data', inEvalSet: false });
    expect(byId.edit).toMatchObject({ id: 'edit', inEvalSet: false });
    expect(byId.mcp).toMatchObject({ id: 'mcp', inEvalSet: false });
  });

  it('every file on disk parses, and its id matches its filename', () => {
    for (const t of discoverTasks(DIR)) {
      expect(t.task.id).toBe(t.id);
      expect(fs.existsSync(t.file)).toBe(true);
    }
  });
});

describe('selectTasks', () => {
  const found = discoverTasks(DIR);

  it('the eval matrix runs ONLY the .eval.json tasks', () => {
    expect(selectTasks(found, { set: 'eval' }).map((t) => t.id).sort()).toEqual(filesIn('eval'));
  });

  it('CI runs ONLY the product guards — the creative briefs are not a per-PR question', () => {
    const ids = selectTasks(found, { set: 'ci' }).map((t) => t.id).sort();
    expect(ids).toEqual(filesIn('ci'));
    // Named, because membership is the point for both: `comment` brings a whole KIND, and `no-token`
    // is here for the same reason the older three are — it has ONE right answer (stop and ask your
    // human), so paying six comparison legs to re-answer it buys nothing.
    expect(ids).toContain('comment');
    expect(ids).toContain('no-token');
  });

  it('the two sets are disjoint and together cover every task on disk', () => {
    const evalIds = selectTasks(found, { set: 'eval' }).map((t) => t.id);
    const ciIds = selectTasks(found, { set: 'ci' }).map((t) => t.id);
    expect(evalIds.filter((id) => ciIds.includes(id))).toEqual([]);
    expect([...evalIds, ...ciIds].sort()).toEqual(found.map((t) => t.id).sort());
  });

  it('explicit ids win over the set and keep the order given', () => {
    expect(selectTasks(found, { set: 'eval', ids: ['edit', 'scrolly'] }).map((t) => t.id)).toEqual(['edit', 'scrolly']);
  });

  it('names the unknown id and what is available', () => {
    expect(() => selectTasks(found, { ids: ['nope'] })).toThrow(/unknown task "nope".*scrolly/);
  });
});

describe('shardTasks', () => {
  /**
   * CI runs every task on one leg, sequentially — the agent work is the job's
   * whole cost. Splitting the tasks across parallel jobs is the only way to cut
   * that wall time, since each task is one real agent run that cannot be made
   * faster.
   */
  const ids = (ts: ReturnType<typeof discoverTasks>) => ts.map((t) => t.id);
  const found = discoverTasks(DIR);

  it('splits the tasks round-robin so every shard gets work', () => {
    const a = shardTasks(found, { index: 1, total: 2 });
    const b = shardTasks(found, { index: 2, total: 2 });
    expect(a.length + b.length).toBe(found.length);
    expect([...ids(a), ...ids(b)].sort()).toEqual(ids(found).sort());
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('is the identity when there is one shard', () => {
    expect(ids(shardTasks(found, { index: 1, total: 1 }))).toEqual(ids(found));
  });

  it('never puts a task in two shards, at any shard count', () => {
    for (const total of [2, 3, 5, 7]) {
      const seen: string[] = [];
      for (let index = 1; index <= total; index++) seen.push(...ids(shardTasks(found, { index, total })));
      expect(seen.sort()).toEqual(ids(found).sort());
    }
  });

  it('rejects a shard spec that is out of range', () => {
    expect(() => shardTasks(found, { index: 0, total: 2 })).toThrow(/shard/i);
    expect(() => shardTasks(found, { index: 3, total: 2 })).toThrow(/shard/i);
  });
});

describe('parseShard', () => {
  it('reads i/n', () => {
    expect(parseShard('2/3')).toEqual({ index: 2, total: 3 });
  });
  it('refuses anything else', () => {
    for (const bad of ['2', 'a/b', '2/0', '', '2/3/4']) expect(() => parseShard(bad)).toThrow(/shard/i);
  });
});

describe('ordering', () => {
  /**
   * The report reads top to bottom in the order tasks run, so the order is
   * editorial: the four product templates follow a deliberate visual sequence.
   */
  it('orders by the task\'s own `order`, then by filename', () => {
    const ids = selectTasks(discoverTasks(DIR), { set: 'eval' }).map((t) => t.id);
    expect(ids).toEqual(['deck', 'dashboard', 'report', 'scrolly', 'comment-image']);
  });

  it('an unordered task sorts before an ordered one, keeping filename order among equals', () => {
    // Every CI task is unordered, so they come back in filename order — which is
    // what `filesIn` reads, sorted the same way `discoverTasks` sorts.
    expect(selectTasks(discoverTasks(DIR), { set: 'ci' }).map((t) => t.id)).toEqual(filesIn('ci'));
    expect(selectTasks(discoverTasks(DIR), { set: 'eval' }).map((t) => t.id).at(-1)).toBe('comment-image');
  });
});

describe('the comparison tasks gate local checkout reads', () => {
  it('every *.eval.json lists no_local_checkout_reads', () => {
    const dir = path.join(__dirname, '../tasks');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.eval.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const checks = (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { checks: string[] }).checks;
      expect(checks, f).toContain('no_local_checkout_reads');
    }
  });
});
