#!/usr/bin/env node
/**
 * THE PAGE-SPEED BASE IS MAIN'S OWN MEASUREMENT, NOT A SECOND BUILD OF IT.
 *
 * Every push to main that touches the lab's paths already measures its head and uploads
 * `page-speed-head`. A pull request's base is such a main commit, so measuring it again (the old
 * `measure base` job: checkout, install, build, browser, 110-148 s) re-measured bytes main had already
 * measured. This picks the newest main push run whose head is an ancestor of the base AND differs from
 * it in none of the workflow's own `paths` — the same bytes by the workflow's own definition — and
 * whose `page-speed-head` artifact has not expired. No such run (main's run skipped the path, is still
 * in flight, or its artifact expired), a dispatched timing run (main's artifacts are size-only), or any
 * API failure: `found=false`, and the report job measures the base itself, exactly as before.
 *
 *   usage: node scripts/ci/page-speed-base.mjs   (env: EVENT, PR_BASE, BEFORE, GH_TOKEN,
 *                                                  GITHUB_REPOSITORY, GITHUB_OUTPUT)
 * Writes `found`, `base` (the commit to measure on a miss) and, on a hit, `run-id` and `sha`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKFLOW = '.github/workflows/page-speed.yml';

/**
 * The `push:` trigger's `paths`, read from the workflow text itself so the "same bytes" test and the
 * trigger can never disagree. Line-based on purpose: the report job has no install to parse YAML with,
 * and scripts/__tests__/workflows.test.mjs holds this equal to the parsed trigger.
 */
export function triggerPaths(text) {
  const lines = text.split('\n');
  const push = lines.findIndex((line) => /^ {2}push:\s*$/.test(line));
  if (push < 0) return [];
  const paths = [];
  let inPaths = false;
  for (const line of lines.slice(push + 1)) {
    if (/^ {0,2}\S/.test(line)) break;
    if (/^ {4}paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (/^ {4}\S/.test(line)) { inPaths = false; continue; }
    const item = /^ {6}- '([^']+)'\s*$/.exec(line);
    if (inPaths && item) paths.push(item[1]);
  }
  return paths;
}

/** The commit a measurement of the base must match, chosen as the old `measure base` job chose it. */
export function baseCommit({ EVENT, PR_BASE, BEFORE }, isCommit) {
  const base = EVENT === 'pull_request' ? PR_BASE : EVENT === 'push' ? BEFORE : '';
  return base && isCommit(base) ? base : null;
}

/**
 * The newest run whose measured bytes are the base's: its head is the base or an ancestor of it with
 * no change under the trigger paths in between, and its `page-speed-head` artifact is still there.
 * `runs` newest first, as the API lists them.
 */
export async function chooseBaseRun(runs, base, { sameBytes, hasArtifact }) {
  for (const run of runs) {
    if (!sameBytes(run.head_sha, base)) continue;
    if (await hasArtifact(run.id)) return run;
  }
  return null;
}

async function api(route) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}${route}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  return response.json();
}

const git = (args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
const succeeds = (args) => { try { git(args); return true; } catch { return false; } };

async function main() {
  const output = (values) => {
    const text = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
    process.stdout.write(text);
  };
  const isCommit = (rev) => succeeds(['cat-file', '-e', `${rev}^{commit}`]);
  const base = baseCommit(process.env, isCommit) ?? git(['rev-parse', 'HEAD~1']).trim();
  if (process.env.EVENT === 'workflow_dispatch') {
    console.error('A dispatched run measures timings; main measures sizes only. Measuring the base here.');
    return output({ found: false, base });
  }
  const paths = triggerPaths(readFileSync(path.resolve(import.meta.dirname, '../..', WORKFLOW), 'utf8'));
  if (!paths.length) throw new Error(`No push paths in ${WORKFLOW}`);
  try {
    const { workflow_runs: runs = [] } = await api(`/actions/workflows/page-speed.yml/runs?branch=main&event=push&status=completed&per_page=50`);
    const run = await chooseBaseRun(runs, base, {
      sameBytes: (sha, target) => isCommit(sha) && succeeds(['merge-base', '--is-ancestor', sha, target])
        && succeeds(['diff', '--quiet', sha, target, '--', ...paths]),
      hasArtifact: async (id) => {
        const { artifacts = [] } = await api(`/actions/runs/${id}/artifacts?name=page-speed-head`);
        return artifacts.some((artifact) => artifact.expired === false);
      },
    });
    if (run) {
      console.error(`Base ${base} measures as main run ${run.id} (${run.head_sha}): same bytes under the trigger paths.`);
      return output({ found: true, base, 'run-id': run.id, sha: run.head_sha });
    }
    console.error(`No main run measured ${base}'s bytes; measuring the base here.`);
  } catch (error) {
    console.error(`Main's measurement lookup failed (${error.message}); measuring the base here.`);
  }
  return output({ found: false, base });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
