/**
 * Which tasks run where — decided by the FILENAME, the way minusx marks its
 * measured flows `*.eval.spec.ts`:
 *
 *   tasks/<id>.eval.json — the QA eval set: one band of the comparison report,
 *                          paid for once per LEG. These are the creative briefs
 *                          (deck, dashboard, editorial, scrolly) — expensive, and worth
 *                          it only where the point is comparing models.
 *   tasks/<id>.json      — CI only. A flow that guards the PRODUCT (can an agent
 *                          still build a chart from a CSV? rebase an edit? work
 *                          over MCP?), never a report column: it has one right
 *                          answer, so paying six legs to re-answer it buys
 *                          nothing a single cheap leg does not already say.
 *
 * The two sets are DISJOINT, and CI runs only its own. Running the creative
 * briefs on every pull request would cost minutes and dollars to re-answer a
 * question that is not a regression — CI's job is "does the product still let an
 * agent do this", which the cheap tasks already answer.
 *
 * "This file spends money on every leg of every comparison" is then visible at
 * a glance, and the selector is a suffix rather than a list to keep in step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TaskSchema, type Task } from './contracts';

export interface DiscoveredTask {
  id: string;
  file: string;
  /** Named `<id>.eval.json`: part of the comparison matrix. */
  inEvalSet: boolean;
  task: Task;
}

export function discoverTasks(dir: string): DiscoveredTask[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      const inEvalSet = f.endsWith('.eval.json');
      const id = f.replace(/\.eval\.json$/, '').replace(/\.json$/, '');
      const task = TaskSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (task.id !== id) throw new Error(`task ${file}: id "${task.id}" does not match its filename ("${id}")`);
      return { id, file, inEvalSet, task };
    })
    // Stable: `sort` above fixed filename order, and this is a stable sort, so ties keep it.
    .sort((a, b) => a.task.order - b.task.order);
}

export interface TaskSelector {
  /** `eval` = the comparison matrix (`*.eval.json`); `ci` = the product guards. Ignored when `ids` is given. */
  set?: 'eval' | 'ci';
  ids?: string[];
}

export interface Shard {
  /** 1-based. */
  index: number;
  total: number;
}

/** `i/n`, the shape CI matrices use. */
export function parseShard(spec: string): Shard {
  const m = /^(\d+)\/(\d+)$/.exec(spec.trim());
  if (!m) throw new Error(`shard must be written i/n (got "${spec}")`);
  const shard = { index: Number(m[1]), total: Number(m[2]) };
  if (shard.total < 1 || shard.index < 1 || shard.index > shard.total) throw new Error(`shard ${spec} is out of range`);
  return shard;
}

/**
 * One shard's tasks, dealt ROUND-ROBIN rather than in contiguous blocks.
 *
 * Every task is one real agent run, so a task cannot be made faster — splitting
 * them across parallel jobs is the only way to cut the wall time CI waits for.
 * Round-robin because the tasks differ in length: contiguous blocks can put
 * the slow ones together and the
 * job would be as long as before.
 */
export function shardTasks(found: DiscoveredTask[], shard: Shard): DiscoveredTask[] {
  if (shard.total < 1 || shard.index < 1 || shard.index > shard.total) {
    throw new Error(`shard ${shard.index}/${shard.total} is out of range`);
  }
  return found.filter((_, i) => i % shard.total === shard.index - 1);
}

export function selectTasks(found: DiscoveredTask[], sel: TaskSelector): DiscoveredTask[] {
  if (sel.ids && sel.ids.length) {
    const byId = new Map(found.map((t) => [t.id, t]));
    return sel.ids.map((id) => {
      const t = byId.get(id);
      if (!t) throw new Error(`unknown task "${id}" — known: ${found.map((f) => f.id).join(', ')}`);
      return t;
    });
  }
  return found.filter((t) => (sel.set === 'ci' ? !t.inEvalSet : t.inEvalSet));
}
