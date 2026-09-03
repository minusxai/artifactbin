/**
 * THE PER-TASK SCORER CONTRACT — what a task KIND is.
 *
 * A kind owns three things that used to be spread across three shared files:
 * the CHECK NAMES it can answer (a closed enum in `contracts.ts`, so three
 * names cost an edit there), the driver-side SETUP its task needs before the
 * agent runs (a conditional in `main.ts`), and the product-side CHECKS that
 * grade it (another conditional in `main.ts`). `main.ts` now asks the registry
 * and stays a driver.
 *
 * `publish` is the default and is every task that existed before this: publish
 * a document, and — where the task seeds one to edit — say that a phrase
 * survived. `comment` is the first kind that needed a seam at all, because its
 * setup makes four HTTP calls of its own and its checks read a second endpoint.
 *
 * SETUP RUNS BEFORE THE `published` BASELINE IS READ, and that ordering is this
 * module's (`prepareTask`), not the driver's: a comment's anchor stamp is a
 * REAL edit — it bumps the version and rewrites the stored markup — so a
 * baseline read before it would make `published` true for a document the agent
 * never touched. A setup failure is named and does not spend an agent turn.
 */
import type { MetricKind, MetricValue, Task } from '../../contracts';
import type { ServedDocument } from '../product';

export const TASK_KINDS = ['publish', 'comment'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** What a kind's `setup` is given. Every call it makes is the DRIVER's, and none of it may reach the agent's ledger. */
export interface SetupContext {
  task: Task;
  /** The base the AGENT will be given — this task's own recording proxy. */
  base: string;
  /** The start document the agent is handed. */
  id: string;
  /** The credential the driver holds. Null when the task's handoff never gave it one. */
  token: string | null;
  /**
   * Headers that mark a call as the driver's. `lib/proxy` swaps recording for a
   * no-op when it sees them, which is what keeps the driver's own setup out of
   * the ledger the agent is scored on — the kind is handed them rather than
   * knowing the convention.
   */
  driverHeaders: Record<string, string>;
  log: (msg: string) => void;
}

/** What a kind's `checks` is given. Product truth only: the ledger's questions are the driver's. */
export interface CheckContext {
  task: Task;
  /** The product's OWN address — a scoring read must not land in the agent's ledger. */
  productUrl: string;
  /** The document the agent was GIVEN, which is not always the one it wrote (`scoredArtifactId`). */
  startId: string;
  token: string | null;
  driverHeaders: Record<string, string>;
  /** The scored document as served (`/a/<id>/raw?chrome=0`). */
  served: ServedDocument;
  /** Record a row that is REPORTED and never gated — a kind's own evidence for the reader. */
  record: (metric: string, value: MetricValue | null, kind?: MetricKind) => void;
}

export interface TaskScorer {
  readonly kind: TaskKind;
  /** Check names only this kind can answer. A task may list them; another kind's task may not. */
  readonly checkNames: readonly string[];
  /** What this kind needs of a task's JSON, as a message naming what is missing. Runs at LOAD. */
  validate?(task: Task): string | null;
  /** Driver-side preparation, before the agent runs and before the baseline is read. */
  setup(ctx: SetupContext): Promise<void>;
  /** Product-side checks, named. Gated only where the task lists them (`verdictFor`). */
  checks(ctx: CheckContext): Promise<Record<string, boolean | null>>;
}

/**
 * A setup step that failed, carrying WHICH step. The driver reports it as
 * `setup_ok: false` with the step named, never as an agent failure: the
 * driver's calls carry the driver header and are invisible to the ledger, so
 * without a name a broken seed reads as "the agent did nothing".
 */
export class SetupFailure extends Error {
  constructor(readonly step: string, message: string) {
    super(message);
    this.name = 'SetupFailure';
  }
}

export type Prepared =
  | { ok: true; baseline: ServedDocument }
  | { ok: false; step: string; error: string };

/**
 * Prepare the start document, then read the baseline — in that order, and never
 * the other way round.
 *
 * A failure here is the DRIVER's: the baseline is not read, the caller does not
 * spawn the agent, and the step is named so the report says which call broke
 * rather than showing a bare FAIL with an empty `first_error`.
 */
export async function prepareTask(
  scorer: TaskScorer,
  ctx: SetupContext,
  readBaseline: () => Promise<ServedDocument>,
): Promise<Prepared> {
  try {
    await scorer.setup(ctx);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, step: e instanceof SetupFailure ? e.step : 'setup', error };
  }
  return { ok: true, baseline: await readBaseline() };
}
