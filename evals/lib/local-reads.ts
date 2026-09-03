/**
 * Turns spent reading THIS REPO's checkout — the thing an eval must never see.
 *
 * A `fetched_skill` leg measures whether an agent can DISCOVER the protocol over
 * the wire. A readable checkout on the runner invalidates that measurement, and
 * worse: production run 33702277600 (2026-09-03) has pi running
 * `find / -name "*.md" -path "*skill*"`, landing on
 * `/home/runner/work/deploys/deploys/services/app/skills/artifactbin/`, reading the
 * whole skill tree off disk — and then reading `evals/tasks/scrolly.eval.json`,
 * which is the GRADING RUBRIC for the task it was being graded on.
 *
 * Isolation (running the harness as a unix user that cannot read the checkout)
 * is the fix; this is the DETECTOR, and it stays whether or not isolation holds,
 * because a leaked rubric that nobody counted is a number nobody can trust.
 *
 * Pure, and deliberately the same shape as `lib/docs-reads`: adapters hand over
 * the tool invocations their event stream carries, and get a count back.
 */
import { invocationText, type ToolInvocation } from './docs-reads';

/**
 * Paths that belong to this repo and to nothing else, matched RELATIVELY — the
 * root the driver runs from is passed in, but an agent reaches the checkout by
 * many spellings (`../deploys/evals/tasks/...`, a symlink, a `cd` two calls
 * earlier), so the two directories that matter are recognised wherever they
 * appear. `evals/tasks/` is the rubric; `services/app/skills/` is the skill tree
 * that a `fetched_skill` run is supposed to fetch rather than open.
 *
 * A docs URL is NOT one of these: `https://…/docs/artifactbin/SKILL.md` is the
 * wire, which is exactly what the run is meant to measure.
 */
export const CHECKOUT_MARKERS = ['evals/tasks/', 'services/app/skills/'] as const;

/**
 * How many tool calls touched the local checkout: a call counts once when its
 * input names any of `roots` (absolute paths of the repo the driver runs from)
 * or any `CHECKOUT_MARKERS` path.
 */
export function countCheckoutReads(calls: ToolInvocation[], roots: string[]): number {
  const needles = [...roots.filter((r) => r.length > 0), ...CHECKOUT_MARKERS];
  let n = 0;
  for (const call of calls) {
    const t = invocationText(call.input);
    if (!t) continue;
    if (needles.some((needle) => t.includes(needle))) n += 1;
  }
  return n;
}
