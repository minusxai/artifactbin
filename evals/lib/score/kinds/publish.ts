/**
 * The `publish` kind — the default, and every task that existed before the
 * seam: the agent is asked to publish a document, and the run is judged on what
 * the product then serves.
 *
 * It needs no setup of its own. Seeding a document is declared by the task's
 * own `seed`, not by its kind, and the driver publishes it for either kind
 * before this runs.
 *
 * Its one check is `kept_untouched_text`, moved here UNCHANGED from the
 * conditional it was in `main.ts`: the phrase a targeted edit must leave alone,
 * read from the served document. Null — never false — for a task that seeds
 * nothing, so an inapplicable check reads "—" rather than as a failure.
 */
import type { CheckContext, TaskScorer } from './contract';

/**
 * Declared apart from the scorer below because `contracts.ts` builds its check
 * enum from these names, and reading them off an object annotated with
 * `TaskScorer` — whose `validate` takes a `Task` — would make the task type
 * reference itself through the enum it defines.
 */
export const PUBLISH_CHECKS = ['kept_untouched_text'] as const;

export const publishScorer = {
  kind: 'publish',
  checkNames: PUBLISH_CHECKS,
  async setup() {},
  async checks(ctx: CheckContext) {
    return {
      kept_untouched_text: ctx.task.seedKeepText ? ctx.served.html.includes(ctx.task.seedKeepText) : null,
    };
  },
} as const satisfies TaskScorer;
