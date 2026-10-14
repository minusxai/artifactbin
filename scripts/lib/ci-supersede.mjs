import {pathToFileURL} from 'node:url';

/**
 * A new push supersedes its pull request's earlier CI runs WITHOUT waiting for them to stop. A workflow-level
 * `concurrency` group with cancel-in-progress holds the new run pending until the cancelled one has wound down,
 * always() roll-up included (run 38627878372 started its first job 84s late, 3s after run 38627752110 finished
 * cancelling); ci.yml's `supersede` job cancels them through the API instead, and no job waits for it.
 *
 * Superseded: the same workflow's runs for the same head repository and branch (the listing is filtered by
 * branch), created before this one (a lower run id) and not yet completed.
 * @param {{id: number, status: string, head_branch?: string, head_repository?: {full_name?: string} | null}[]} runs
 * @param {{runId: number, headRepository: string, headBranch: string}} self
 * @returns {number[]}
 */
export function supersededRuns(runs, {runId, headRepository, headBranch}) {
  if (!Number.isInteger(runId) || !headRepository || !headBranch) return [];
  return runs
    .filter((run) => Number.isInteger(run.id) && run.id < runId && run.status !== 'completed'
      && run.head_branch === headBranch && run.head_repository?.full_name === headRepository)
    .map((run) => run.id);
}

// Builtin-only CLI boundary (no install): GitHub's run listing in, cancellations out. Never fails the job: a
// fork's read-only token cannot cancel, and its earlier run then simply finishes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = {authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28'};
  const self = {runId: Number(env.GITHUB_RUN_ID), headRepository: env.HEAD_REPOSITORY, headBranch: env.HEAD_REF};
  try {
    const query = new URLSearchParams({event: 'pull_request', branch: self.headBranch ?? '', per_page: '100'});
    const response = await fetch(`${api}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${env.WORKFLOW_FILE}/runs?${query}`, {headers});
    if (!response.ok) throw new Error(`run listing answered ${response.status}`);
    const {workflow_runs: runs = []} = await response.json();
    for (const id of supersededRuns(runs, self)) {
      const cancel = await fetch(`${api}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${id}/cancel`, {method: 'POST', headers});
      console.log(cancel.ok ? `cancelled superseded run ${id}` : `::notice::superseded run ${id} was not cancelled (${cancel.status})`);
    }
  } catch (error) {
    console.log(`::notice::earlier runs were not superseded: ${error.message}`);
  }
}
