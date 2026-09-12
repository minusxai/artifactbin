/**
 * WHAT THE DRIVER DOES BEFORE THE TURN, and what the agent is told.
 *
 * artifactbin is CLI-only: the single credential path is afbin's OAuth device approval in a browser,
 * which the driver approves on the person's behalf (`lib/auth.ts` before the turn in `installed`,
 * `lib/approver.ts` during it in `not-installed`). So there is no per-task credential variation left —
 * every task is authenticated by its MODE, every task is handed a document the driver made as the eval
 * account, and the only thing a task still decides for itself is whether that document arrives SEEDED.
 */
import { existingPaste } from '../../services/app/lib/agent-copy';
import type { Task } from './contracts';

/** Where the agent works: the address it is given, and the document waiting for it there. */
export interface Access { base: string; id: string }

/** The document the driver minted for this task (`lib/retry mintStartDocumentAs`). */
export interface StartDocument { id: string }

export interface AccessPlanInput { task: Task; base: string; start: StartDocument; credential: { token: string } }
export interface AccessPlan { access: Access; seed: { id: string; token: string; markup: string } | null }

/**
 * The driver's pre-turn plan, decided in ONE place and performed by the caller: which document the
 * agent is pointed at, and the markup to publish into it first for a task that edits or is commented on.
 */
export function planAccess({ task, base, start, credential }: AccessPlanInput): AccessPlan {
  return {
    access: { base, id: start.id },
    seed: task.seed === undefined ? null : { id: start.id, token: credential.token, markup: task.seed },
  };
}

/**
 * The prompt SHAPE, independent of CLI staging (which is the `mode` axis).
 * `starter` is the product's OWN handover text (`existingPaste`) — the link plus how to reach afbin —
 * and is the SAME text whether the driver pre-installed the CLI (`installed` mode) or the agent must
 * install it (`not-installed` mode). `hardcore` strips all of that: only the brief, the vision note
 * when relevant, and the bare base.
 */
export const PROMPT_LEVELS = ['hardcore', 'starter'] as const;
export type PromptLevel = (typeof PROMPT_LEVELS)[number];
export const DEFAULT_PROMPT_LEVEL: PromptLevel = 'starter';
export function parsePromptLevel(raw: string): PromptLevel {
  if (!(PROMPT_LEVELS as readonly string[]).includes(raw)) throw new Error(`unknown --prompt "${raw}" — known: ${PROMPT_LEVELS.join(', ')}`);
  return raw as PromptLevel;
}
export interface PromptOptions { vision?: boolean; promptLevel?: PromptLevel }
const VISION_LINE = 'You cannot view images. Check your work by reading the document markup.';

/**
 * The agent's prompt: the task brief, and nothing about artifactbin that the product does not itself
 * hand a person to paste. The starter line is imported rather than spelled again here, so the eval
 * measures the text the product ships (`services/app/lib/agent-copy`) and the two cannot drift.
 */
export function buildPrompt(task: Task, access: Access, opts: PromptOptions = {}): string {
  const level = opts.promptLevel ?? DEFAULT_PROMPT_LEVEL;
  const vision = opts.vision === false ? [VISION_LINE] : [];
  // Hardcore gives the document link and nothing else — never the installer or the word afbin. A person
  // pastes a link, not a base URL; the first hardcore run (34704712847) gave only the base, so no agent
  // could edit the document it was scored against and used_start_document failed 16 of 16.
  if (level === 'hardcore') return [task.brief, ...vision, `The document is at ${access.base.replace(/\/$/, '')}/a/${access.id}.`].join('\n\n');
  return [existingPaste(access.base, access.id), task.brief, ...vision].join('\n\n');
}
