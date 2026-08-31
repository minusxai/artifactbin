/**
 * The run recorder — writes the minusx row schema. One rows file per run
 * (named by the task), `meta.json` once per run directory (one report column),
 * and a derived `pass` row per declared flow on `finalize()`, so a run that
 * died early still shows FAIL instead of vanishing from the report.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ImageVariant } from './image-variants';
import type { MetricKind, MetricRow, MetricValue, RunMeta } from './contracts';
import { slug } from './slug';

/**
 * The brief the agent was given, recorded as an ordinary row so it merges,
 * renders and travels like every other metric — no special case anywhere.
 *
 * It is per RUN, not read from `tasks/` at render time, because `eval:report`
 * merges run directories produced by separate jobs on possibly DIFFERENT
 * commits: reading the task file when the report is drawn would show today's
 * brief beside a run that was given last week's, silently. Carrying it in the
 * row shows what was actually asked, and a divergence between two legs lands
 * side by side in its own cells rather than being collapsed to one answer.
 */
export const TASK_BRIEF = 'Task Brief';

export class RunRecorder {
  private readonly rows: MetricRow[] = [];
  private readonly flows: string[] = [];
  private readonly ungraded: string[] = [];

  constructor(readonly dir: string, readonly meta: RunMeta, readonly runId: string) {
    fs.mkdirSync(path.join(dir, 'rows'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  }

  /**
   * Declare a flow BEFORE its work, so it gets a pass row even if the work never
   * records anything. `brief` is what the agent was asked for; recorded here
   * rather than by the caller so it is always the flow's FIRST row and the
   * report's section opens with the question before its answers.
   */
  flow(name: string, brief?: string, opts: { graded?: boolean } = {}): void {
    if (this.flows.includes(name)) return;
    // An UNGRADED flow reports without being scored. The baseline probe is the case:
    // it is a measurement of what a leg costs before it does anything, not a task
    // that can pass or fail, and giving it a pass row would put it in the
    // denominator of "4/4 passed".
    (opts.graded === false ? this.ungraded : this.flows).push(name);
    if (brief) this.record(name, TASK_BRIEF, brief, 'text');
  }

  /** A null value is "unavailable" — nothing is written, the report shows "—". */
  record(flow: string, metric: string, value: MetricValue | null, kind?: MetricKind): void {
    if (value === null || value === undefined) return;
    this.rows.push({ flow, metric, value, kind: kind ?? (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'pass' : 'text') });
  }

  /** Where a capture of `name` in `variant` belongs, relative to the run dir. */
  screenshotPath(flow: string, name: string, variant: ImageVariant): string {
    return `screens/${slug(flow)}-${slug(name)}-${variant.size}-${variant.renderer}.png`;
  }

  image(flow: string, metric: string, relPath: string, variant: ImageVariant): void {
    this.rows.push({ flow, metric, value: relPath, kind: 'image', variant });
  }

  finalize(passed: boolean): void {
    for (const flow of this.flows) this.rows.push({ flow, metric: 'pass', value: passed, kind: 'pass' });
    fs.writeFileSync(path.join(this.dir, 'rows', `${slug(this.runId)}.json`), JSON.stringify({ rows: this.rows }, null, 2));
  }
}
