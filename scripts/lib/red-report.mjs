/**
 * WHAT A RED `ci` RUN SAYS ABOUT ITSELF (ci.yml's `test` roll-up, `node scripts/ci/ci.mjs red-report`): the commits
 * since the last green `ci` push run on main, the jobs that failed and the test files their logs name as failing, in
 * the run's summary and as one error annotation. A red main names its suspects and its tests on the run itself, the way
 * a batch would, so the next pull request starts from them (AGENTS.md: every post-merge failure gets a fast-lane guard).
 * Pure: scripts/ci/ci.mjs reads the GitHub API and hands the answers here. Builtin-only, like everything the roll-up
 * loads (scripts/__tests__/ci-plan.test.mjs).
 */

/** A Vitest log's failing test files, in order of first mention: its `FAIL` lines, colours stripped. @param {string} log */
export function failingTestFiles(log) {
  const files = new Set();
  for (const line of log.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const match = /\bFAIL\b\s.*?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/.exec(line);
    if (match) files.add(match[1]);
  }
  return [...files];
}

/**
 * The report's markdown and its one-line annotation.
 * @param {{ head: string, green: { sha: string, run: number } | null, commits: Array<{ sha: string, subject: string }>, jobs: Array<{ name: string, files: string[] }> }} input
 */
export function redReport({ head, green, commits, jobs }) {
  const short = (sha) => sha.slice(0, 9);
  const files = [...new Set(jobs.flatMap((job) => job.files))];
  const since = green ? `since the last green ci run on main (${short(green.sha)}, run ${green.run})` : 'with no green ci run on main to compare against';
  const lines = [
    `## ci is red at ${short(head)}`,
    '',
    `${commits.length} commit(s) ${since}:`,
    '',
    ...commits.map((commit) => `- ${short(commit.sha)} ${commit.subject}`),
    '',
    'Failed jobs and the test files their logs name:',
    '',
    ...jobs.map((job) => `- ${job.name}${job.files.length ? `: ${job.files.map((file) => `\`${file}\``).join(', ')}` : ' (no failing test file in its log)'}`),
    '',
    'Find why pr fast did not run each failing file for the commits above, and add the guard (scripts/ci/AGENTS.md).',
  ];
  const annotation = `ci is red at ${short(head)}: ${jobs.map((job) => job.name).join(', ')} failed`
    + (files.length ? ` (${files.join(', ')})` : '') + `; ${commits.length} commit(s) ${since}.`;
  return { markdown: `${lines.join('\n')}\n`, annotation };
}
