/**
 * A CI flow that fails gets ONE more turn, alone, and is NAMED when it passes there.
 *
 * An agent smoke run's verdict is a model's behaviour, not the product's, so a single red says
 * nothing. Two rules keep the retry from laundering it: **CI ONLY** — the comparison matrix
 * (`*.eval.json`) is a measurement and re-rolling a column would void it, while the CI set
 * (`<id>.json`) is a product guard where asking twice is legitimate — and **REPORTED**, with the
 * flow named in the summary and the first attempt's artifacts kept at `runs/<id>@1`. Twice fails
 * the job. One extra attempt, not a loop: each attempt is a paid agent run. See docs/evals.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Task } from './contracts';

/**
 * What one flow came to.
 *
 *  - `true` / `false` — it passed, or it failed and may have failed by coin toss.
 *  - `null` — deliberately not run; it is not a failure.
 *  - `'runaway'` — it failed AND the driver had to stop it: the turn cap fired, or the wall clock did
 *    (`lib/spawn TurnCap`). That is structural, not flaky: the same prompt will loop the same way, so
 *    the retry below would spend a second paid run to learn nothing. It stays red.
 */
export type Outcome = boolean | null | 'runaway';

export interface SecondAttemptPlan {
  /** Indexes into the task list that get one more turn — empty when nothing should. */
  indexes: number[];
}

/**
 * Which flows earn a second attempt. Only failures, only in CI, and only when
 * the caller has not asked for the retry to be off.
 */
export function planSecondAttempt(verdicts: Outcome[], opts: { ci: boolean; enabled: boolean }): SecondAttemptPlan {
  if (!opts.ci || !opts.enabled) return { indexes: [] };
  // `'runaway'` is excluded on purpose — see `Outcome`. Only an ordinary failure earns another turn.
  return { indexes: verdicts.flatMap((v, i) => (v === false ? [i] : [])) };
}

export interface MergedVerdicts {
  verdicts: Outcome[];
  /** Ids that failed first and passed on the second attempt — the ones to NAME. */
  recovered: string[];
  /** Ids that failed twice. */
  failed: string[];
}

/** The first pass's verdicts with the second attempt's written over them, and who moved. */
export function mergeSecondAttempt(tasks: Task[], first: Outcome[], second: Map<number, Outcome>): MergedVerdicts {
  const verdicts = first.map((v, i) => (second.has(i) ? second.get(i)! : v));
  const recovered = [...second.entries()].filter(([, v]) => v === true).map(([i]) => tasks[i].id);
  const failed = tasks.filter((_, i) => verdicts[i] === false || verdicts[i] === 'runaway').map((t) => t.id);
  return { verdicts, recovered, failed };
}

/**
 * The one line the log and the job summary end on. A retry that is not said out
 * loud is the failure mode this whole module exists to avoid, so "passed on a
 * second attempt" is part of the verdict, never a footnote.
 */
export function verdictLine({ verdicts, recovered, failed }: MergedVerdicts): string {
  const ran = verdicts.filter((v) => v !== null);
  // `=== true`, never truthiness: a `'runaway'` is a non-empty string, and counting it as a pass is
  // exactly the sort of green a job would then report for a run the driver had to kill.
  const passed = ran.filter((v) => v === true).length;
  const parts = [`${passed}/${ran.length} flows passed`];
  if (recovered.length) parts.push(`FLAKY (passed on a second attempt): ${recovered.join(', ')}`);
  if (failed.length) parts.push(`FAILED: ${failed.join(', ')}`);
  return parts.join(' — ');
}

/**
 * Move a failed flow's artifacts aside before it runs again.
 *
 * Its transcript, ledger and screens are the only record of the flake, so they
 * are KEPT (`runs/<id>@1/`). Its ROWS are not left in `rows/`: the report reduces
 * a `pass` metric across every row it finds for a flow with `every(...)`, so a
 * losing scorecard beside the winning one would make the report say "failed"
 * about a flow the verdict line calls recovered — two answers to one question.
 * The scorecard moves in with the rest of that attempt's evidence instead.
 */
export function keepFirstAttempt(outDir: string, taskId: string): void {
  const from = path.join(outDir, 'runs', taskId);
  const kept = path.join(outDir, 'runs', `${taskId}@1`);
  const rows = path.join(outDir, 'rows', `${taskId}.json`);
  const hasRun = fs.existsSync(from);
  const hasRows = fs.existsSync(rows);
  // Nothing to keep is not a reason to DELETE what is already kept: the clear
  // has to be part of replacing, or a second call throws the evidence away.
  if (!hasRun && !hasRows) return;
  fs.rmSync(kept, { recursive: true, force: true });
  if (hasRun) fs.renameSync(from, kept);
  if (hasRows) {
    fs.mkdirSync(kept, { recursive: true });
    fs.renameSync(rows, path.join(kept, 'rows.json'));
  }
}

export interface SecondAttemptRun {
  ci: boolean;
  enabled: boolean;
  outDir: string;
  /** Runs ONE flow again and answers its verdict — the paid part, injected so the loop is testable. */
  rerun: (task: Task) => Promise<Outcome>;
  /** Told before each retry, so a run says out loud that it is spending another turn. */
  announce?: (task: Task) => void;
  /** Injected only by the tests that must not touch a real run directory. */
  keep?: (outDir: string, taskId: string) => void;
}

/**
 * Give every failed CI flow its one extra turn and answer the merged verdict.
 *
 * The loop is here rather than inlined in run.ts because the loop is where the
 * cost lives: it decides what is re-run, what happens to the first attempt's
 * artifacts, and which verdict wins — and both bugs this feature shipped with
 * were in exactly that wiring (a re-run that emptied the whole run directory,
 * and a kept scorecard that made the report contradict the verdict). With the
 * paid part injected, a fail-then-pass can be exercised for real instead of
 * being argued about: no agent, no network, same code path.
 */
export async function runSecondAttempts(tasks: Task[], first: Outcome[], opts: SecondAttemptRun): Promise<MergedVerdicts> {
  const keep = opts.keep ?? keepFirstAttempt;
  const second = new Map<number, Outcome>();
  for (const i of planSecondAttempt(first, { ci: opts.ci, enabled: opts.enabled }).indexes) {
    const task = tasks[i];
    opts.announce?.(task);
    keep(opts.outDir, task.id);
    second.set(i, await opts.rerun(task));
  }
  return mergeSecondAttempt(tasks, first, second);
}
