/**
 * THE KIND REGISTRY — the one place that knows which kinds exist.
 *
 * Kept apart from `./contract` (the types every kind imports) so a kind module
 * can throw a `SetupFailure` without importing the module that imports it.
 */
import type { TaskKind, TaskScorer } from './contract';
import { TASK_KINDS } from './contract';
import { COMMENT_CHECKS, commentScorer } from './comment';
import { PUBLISH_CHECKS, publishScorer } from './publish';

export * from './contract';

const SCORERS: Record<TaskKind, TaskScorer> = {
  publish: publishScorer,
  comment: commentScorer,
};

export function scorerFor(kind: string): TaskScorer {
  const scorer = SCORERS[kind as TaskKind];
  if (!scorer) throw new Error(`unknown task kind "${kind}" — known: ${TASK_KINDS.join(', ')}`);
  return scorer;
}

/** The check names a task of this kind may list, beyond the ones every run answers. */
export function checkNamesFor(kind: string): readonly string[] {
  return scorerFor(kind).checkNames;
}

/**
 * Every kind-specific check name there is — the half of the check vocabulary
 * `contracts.ts` does NOT own. Written out rather than derived so the names stay
 * literal types: a task JSON's `checks` is a zod enum, and a widened `string[]`
 * would take the type with it.
 */
export const KIND_CHECK_NAMES = [...PUBLISH_CHECKS, ...COMMENT_CHECKS] as const;

