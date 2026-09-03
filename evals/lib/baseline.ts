/**
 * What a leg costs before it has done anything.
 *
 * Every turn an agent takes resends its harness's fixed context — the system
 * prompt, the tool definitions, and (in installed_skill modes) the skills'
 * names and descriptions. That figure differs enormously between harnesses and
 * between modes, and it is invisible in a per-task total, which is how a
 * production matrix once read an 18,454-token-per-turn flag as "the plugin is
 * 3.4× more expensive".
 *
 * So it is MEASURED and REPORTED, never subtracted. Measured: one turn, one
 * word, no product, no files — the same invocation the tasks use, so a column's
 * baseline is that column's real floor. Reported: its own row at the top of the
 * report, because the overhead is money actually spent and a headline with it
 * silently removed hides its own assumption. A reader who wants the task-only
 * figure can multiply by `turns` and subtract with their eyes, which also keeps
 * the estimate — base context is only ROUGHLY constant across a run — from
 * being dressed up as a measurement.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HarnessAdapter, HarnessRunContext } from './contracts';
import type { Leg } from './leg';
import type { PluginKit } from './plugin-kit';
import { runInvocation } from './spawn';
import { taskCost } from './price';

/** Says nothing, does nothing, touches nothing — so what it costs is the floor and not the work. */
export const BASELINE_PROMPT = 'Reply with the single word OK. Do not use any tool, and do not read or write any file.';

/** The report flow this lands in. The filename it is written under sorts first, so it opens the report. */
export const BASELINE_FLOW = 'baseline — an empty run';
export const BASELINE_ROWS_ID = '00-baseline';

export interface Baseline {
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  turns: number | null;
  ok: boolean;
}

export interface BaselineOptions {
  leg: Leg;
  adapter: HarnessAdapter;
  apiKey: string;
  /** A directory of its own: the probe must not see a task's files or reuse its config. */
  dir: string;
  /** Present in installed_skill modes — the baseline includes what those skills cost to have. */
  plugin?: PluginKit;
  timeoutMs: number;
  /** Run the probe as this unix user — the same isolation the tasks get, so the floor is measured under it too. */
  runAs?: string;
}

export async function measureBaseline(opts: BaselineOptions): Promise<Baseline> {
  const cwd = path.join(opts.dir, 'cwd');
  const homeDir = path.join(opts.dir, 'home');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  const ctx: HarnessRunContext = {
    leg: opts.leg,
    prompt: BASELINE_PROMPT,
    cwd,
    homeDir,
    apiKey: opts.apiKey,
    maxTurns: 1,
    maxBudgetUsd: 1,
    ...(opts.plugin ? { plugin: opts.plugin } : {}),
  };
  await opts.adapter.prepare(ctx);
  const spawned = await runInvocation({ ...opts.adapter.invocation(ctx), redact: [opts.apiKey] }, {
    cwd,
    baseEnv: { ...process.env },
    timeoutMs: opts.timeoutMs,
    stdoutPath: path.join(opts.dir, 'transcript.jsonl'),
    stderrPath: path.join(opts.dir, 'stderr.log'),
    // Same home and same hand-over as a task's run: the probe measured the floor under `--run-as` and
    // died on `EACCES … mkdir '<out>/baseline/home'` because only the directories BELOW its root changed hands.
    homeDir,
    workspaceRoot: opts.dir,
    ...(opts.runAs ? { runAs: opts.runAs } : {}),
  });
  const result = opts.adapter.reduce(spawned.stdout);
  return {
    tokensIn: result.tokens ? result.tokens.input + result.tokens.cacheRead + result.tokens.cacheWrite : null,
    tokensOut: result.tokens ? result.tokens.output : null,
    costUsd: taskCost(result, opts.leg.price).usd,
    turns: result.turns,
    ok: result.ok && !spawned.timedOut,
  };
}
