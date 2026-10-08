#!/usr/bin/env node
/**
 * DOES THIS PULL REQUEST TOUCH THE PAGE-SPEED LAB'S INPUTS?
 *
 * The workflow runs on every pull request so that `page speed report` always reports and can be a
 * required check (a path-filtered workflow that is skipped never reports, and the PR cannot merge).
 * The paths that matter are the `push:` trigger's own `paths`, read from the workflow text, so the
 * pull-request decision and the main-push trigger can never disagree.
 *
 *   usage: node scripts/ci/page-speed-scope.mjs   (env: EVENT, PR_BASE, PR_HEAD, GITHUB_OUTPUT)
 * Writes `relevant=true|false`. Anything but a pull request is relevant; a diff that cannot be read is too.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { triggerPaths } from './page-speed-base.mjs';

/** GitHub path-filter subset the workflow uses: `dir/**` prefixes and exact files. */
export function matchesPath(file, pattern) {
  return pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern;
}

export function touchesLab(files, patterns) {
  return files.some((file) => patterns.some((pattern) => matchesPath(file, pattern)));
}

/** `read(base, head)` returns the files changed on head since it left base. */
export function isRelevant({ EVENT, PR_BASE, PR_HEAD }, patterns, read) {
  if (EVENT !== 'pull_request') return true;
  try {
    return touchesLab(read(PR_BASE, PR_HEAD), patterns);
  } catch {
    return true;
  }
}

const gitDiff = (base, head) => execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' }).split('\n').filter(Boolean);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const patterns = triggerPaths(readFileSync('.github/workflows/page-speed.yml', 'utf8'));
  const relevant = isRelevant(process.env, patterns, gitDiff);
  console.log(`page speed lab inputs changed: ${relevant}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `relevant=${relevant}\n`);
}
