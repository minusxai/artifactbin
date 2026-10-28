import { appendFileSync, readFileSync } from 'node:fs';
import { assessFastBudget } from '../lib/fast-budget.mjs';

const run = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { elapsedMs, passed } = assessFastBudget({ startedAt: run.run_started_at, now: Date.now(), budgetMs: 120_000 });
const message = `Fast workflow clock: ${(elapsedMs / 1000).toFixed(1)}s of 120s, including allocation/setup/install. Final GitHub post steps follow; the job also has a two-minute execution timeout.`;
console.log(message);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
if (!passed) throw new Error('Fast validation exceeded two-minute workflow budget');
