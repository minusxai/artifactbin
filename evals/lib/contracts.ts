/**
 * Agent eval — the contracts every other module speaks.
 *
 * An eval run drives a coding-agent HARNESS (Claude Code, Codex, Pi, OpenCode)
 * with a MODEL against an isolated copy of this product and records what
 * happened as `MetricRow`s — the minusx QA row schema, unchanged, so the
 * side-by-side report (`report.ts`) is a port rather than a rewrite.
 *
 * A LEG is one column of the report: harness × model × provider. A TASK is one
 * band: a brief the agent is given together with the product's own start line.
 * Their JSON files are validated here (zod) so a typo fails at load, not
 * twenty minutes into a matrix.
 */
import { z } from 'zod';
import type { ToolInvocation } from './docs-reads';
import { IMAGE_RENDERERS, IMAGE_SIZES, type ImageVariant } from './image-variants';
import { STORY_TEMPLATE_NAMES } from '../../services/app/lib/validation/atlas-schemas';
import type { Leg } from './leg';
import type { PluginKit } from './plugin-kit';
import type { EvalMode } from './mode';

// ---------------------------------------------------------------- legs

export const HARNESSES = ['claude-code', 'codex', 'pi', 'opencode'] as const;
export type Harness = (typeof HARNESSES)[number];

/**
 * $ per 1M tokens. `cacheRead`/`cacheWrite` default to the INPUT rate — no discount, the conservative
 * direction — and a leg sets them where the provider publishes one (Anthropic: 0.1× / 1.25×, OpenAI: 0.1×).
 * Without this a Claude Code run, which re-reads tens of thousands of cached tokens every turn, is
 * overstated several-fold.
 */
export interface Price {
  in: number;
  out: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Dollars per CALL of a provider-side web search — a flat fee beside the tokens it returns, carried by no usage object. */
  webSearchCall?: number;
}


// ---------------------------------------------------------------- tasks

/** Every boolean the scorer can produce. A task lists which ones it is graded on. */
const CHECKS = [
  'published',
  'published_first_try',
  'read_docs_before_write',
  'no_unknown_endpoints',
  'canonical_stable',
  'has_title',
  'used_start_document',
  'harness_ok',
  'no_console_errors',
  'no_failed_responses',
  'fits_390px',
  'chart_marks_drawn',
  // data
  'dataset_created',
  'query_ran',
  // edit
  'used_edits_endpoint',
  'kept_untouched_text',
  // mcp
  'used_mcp',
  /**
   * The agent never opened this repo's own checkout. A readable checkout hands a
   * `fetched_skill` run the skills it was supposed to fetch AND the task's own
   * grading rubric (`lib/local-reads`).
   */
  'no_local_checkout_reads',
  /**
   * The two the token-less guard grades. They exist because a run with no credential must be judged on
   * what it DID about that, not on a document it was right not to publish.
   */
  'did_not_self_mint',
  'asked_for_a_token',
] as const;
export type Check = (typeof CHECKS)[number];

const TASK_KINDS = ['open', 'data', 'edit'] as const;

export const TaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.enum(TASK_KINDS),
  /** Story template this comparison brief targets, from the product registry. */
  template: z.enum(STORY_TEMPLATE_NAMES).optional(),
  brief: z.string().min(1),
  /**
   * How the agent is given access. `start-link` is the product's own handoff —
   * the exact human paste, where the TOKEN goes to the agent without the driver
   * extracting it. `token` is for tasks the driver must set up first (seed a
   * document to edit, write an MCP config): the driver reads the paste token
   * itself and passes it on in the prompt, which is the other handoff
   * the docs teach. `none` is the absence of both: the agent is told where the store is and given no
   * credential at all, which is the only way to observe what it does when it has none — and it is a CI
   * guard with one right answer (ask your human), never a comparison column, because a task whose right
   * answer is "publish nothing" cannot be graded on what it published.
   */
  handoff: z.enum(['start-link', 'token', 'none']).default('start-link'),
  /** Files staged into the agent's working directory before it runs (relative path → contents). */
  files: z.record(z.string(), z.string()).optional(),
  /** `handoff: token` only: markup the driver publishes to the start document before the agent runs. */
  seed: z.string().optional(),
  /** A phrase from `seed` that a targeted edit must leave alone (`kept_untouched_text`). */
  seedKeepText: z.string().optional(),
  /**
   * Where this task sits in the report, which reads top to bottom in run order.
   * Lower first; ties fall back to filename. Editorial, not functional: the
   * the four template comparisons read deck → dashboard → editorial → scrolly.
   */
  order: z.number().int().default(0),
  checks: z.array(z.enum(CHECKS)).min(1),
})
  /**
   * THE INVERSION, MADE UNREPRESENTABLE. Handed no credential, an agent is supposed to stop and ask
   * its human — so it publishes nothing, so a rubric containing `published` fails exactly the runs
   * that behaved. Measured on production before this line existed: the three agents that minted their
   * own token and published PASSED, the three that stopped and asked FAILED. A reviewer catching that
   * is luck; the loader catching it is not.
   */
  .refine((t) => !(t.handoff === 'none' && t.checks.includes('published')), {
    message: 'a `handoff: none` task hands the agent no credential, so it cannot be graded on `published` — grade what it DID about that',
    path: ['checks'],
  })
  /** …and it cannot be given a seeded document either: publishing one needs a token it must not have. */
  .refine((t) => !(t.handoff === 'none' && t.seed !== undefined), {
    message: 'a `handoff: none` task cannot carry a `seed`: seeding the document needs the very token the task withholds',
    path: ['seed'],
  });
export type Task = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------- config

export const EvalConfigSchema = z.object({
  server: z.object({
    /** First port of the pair a leg takes: server on N, proxy on N+1. */
    portBase: z.number().int().min(1024).max(65000),
    env: z.record(z.string(), z.string()).default({}),
  }),
  run: z.object({
    maxTurns: z.number().int().positive(),
    /**
     * How many of a leg's tasks run at once. Each holds its own proxy, its own ledger and its own
     * agent process, so the only ceiling is the provider's. Measured on the four eval tasks: three
     * of the four took the SAME time at 4-way concurrency as they did alone (an agent run waits on
     * the model, not the CPU), so the default is the size of the set — one wave.
     */
    concurrency: z.number().int().positive(),
    maxBudgetUsd: z.number().positive(),
    timeoutMs: z.number().int().positive(),
  }),
  capture: z.object({
    sizes: z.array(z.enum(IMAGE_SIZES)).min(1),
    renderers: z.array(z.enum(IMAGE_RENDERERS)).min(1),
  }),
  /** Set at runtime by `--deployment`: run against a live deployment rather than a booted server. */
  deployment: z.string().url().optional(),
});
export type EvalConfig = z.infer<typeof EvalConfigSchema>;

// ---------------------------------------------------------------- rows (minusx schema, verbatim)

export type MetricValue = number | boolean | string;
export type MetricKind = 'number' | 'pass' | 'image' | 'text';

export interface MetricRow {
  flow: string;
  metric: string;
  value: MetricValue;
  /** How the renderer treats the value. 'image' values are paths relative to the run dir. */
  kind: MetricKind;
  /** Image rows only: which capture this file is. Absent = the default variant. */
  variant?: ImageVariant;
}

/** Run-level metadata — one per run directory, i.e. one report column. */
export interface RunMeta {
  label: string;
  target: string;
  harness?: Harness;
  model?: string;
  /** ISO time the leg started — the report is named by it. Absent on runs recorded before it existed. */
  startedAt?: string;
  /** How skills were delivered and actions were taken. Absent on legacy runs. */
  mode?: EvalMode;
  /** Set only when the harness could not do the mode that was asked and the nearest thing ran instead. */
  modeSubstitutedWhy?: string;
}

// ---------------------------------------------------------------- harness

export interface TokenUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/**
 * What a harness run yielded, normalized across the four CLIs. `ok` is whether
 * the HARNESS completed without an error stop — not whether the task succeeded;
 * that is the scorer's question. `tokens: null` means the harness emitted no
 * usable telemetry (OpenCode can exit before its final event); the run still
 * counts, the cost cell is empty.
 */
export interface HarnessResult {
  ok: boolean;
  error: string | null;
  /**
   * For Codex this is the number of assistant items emitted (messages, commands, file changes,
   * searches, MCP calls), since its own turn events are one per prompt.
   */
  turns: number | null;
  toolCalls: number | null;
  /** Tool calls that fetched or READ our docs — incl. paging a saved copy. Null when the harness emitted no tool telemetry. See `lib/docs-reads`. */
  docsReadCalls: number | null;
  /**
   * Every tool call the run made, name + input, normalized across the four CLIs.
   * Each adapter already builds this to answer `docsReadCalls`; it is exposed
   * because it is the ONLY record of what the agent touched, and more than one
   * question is asked of it (`lib/local-reads` asks whether it read this
   * checkout). Empty when the harness emitted no tool telemetry.
   */
  invocations: ToolInvocation[];
  tokens: TokenUsage | null;
  /**
   * The harness's own cost figure — THE cost when present. A harness prices its run against the
   * provider it is native to, with that provider's cache rates; ours is the fallback (`taskCost`).
   */
  reportedCostUsd: number | null;
  /** Provider-side web searches, billed per call outside the token counts. Null when the harness has no such item. */
  webSearchCalls: number | null;
  finalMessage: string | null;
}

/** Everything an adapter needs to build a process. Paths are absolute and per-run. */
export interface HarnessRunContext {
  leg: Leg;
  prompt: string;
  /** Empty working directory the agent runs in. */
  cwd: string;
  /** Per-run config/home dir — `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`, `OPENCODE_CONFIG_DIR`. */
  homeDir: string;
  apiKey: string;
  maxTurns: number;
  maxBudgetUsd: number;
  /** Set when the mode's action axis is MCP: the harness is wired to this server. */
  mcp?: McpTarget;
  /**
   * Set when skills are installed: the materialized marketplace holding this
   * deployment's skills. Each harness installs it its own way — there is no
   * common command — so the adapter, not the driver, decides what to do with it.
   */
  plugin?: PluginKit;
}

export interface HarnessInvocation {
  argv: string[];
  /** Variables ADDED to the driver's base environment. */
  env: Record<string, string>;
  /** Variables REMOVED from it (e.g. a nested-session marker). */
  unsetEnv: string[];
  /**
   * Judge one stdout LINE as it arrives: false discards it before it reaches
   * memory or the transcript. A streaming harness re-sends its whole partial
   * message on every token, which is quadratic in the document being written —
   * one real Pi run produced a 541 MB transcript and died with EPIPE.
   */
  keepLine?: (line: string) => boolean;
  /**
   * Strings that must never reach disk. The provider key travels to the harness
   * in its environment, and the harness's stdout becomes a transcript that CI
   * uploads as an artifact — so anything a harness echoes back is redacted
   * before it is written or returned.
   */
  redact?: string[];
}

/** Where a task's MCP transport points the harness. */
export interface McpTarget {
  name: string;
  url: string;
  token: string;
}

export interface HarnessAdapter {
  readonly harness: Harness;
  /** Can this harness talk to an MCP server at all? Pi cannot — it ships no MCP client. */
  readonly supportsMcp: boolean;
  /** One-time setup inside `ctx.homeDir` (a login file, a provider config). May be a no-op. */
  prepare(ctx: HarnessRunContext): Promise<void>;
  /** Pure: the process to spawn. */
  invocation(ctx: HarnessRunContext): HarnessInvocation;
  /** Pure: the captured stdout (the harness's event stream) → normalized result. */
  reduce(stdout: string): HarnessResult;
  /** Pure: keep this stdout line? Omitted means keep everything. See `HarnessInvocation.keepLine`. */
  keepLine?(line: string): boolean;
}

// ---------------------------------------------------------------- ledger

/** One request the agent made through the leg's recording proxy. */
export interface LedgerEntry {
  /** ms since epoch at request start. */
  t: number;
  ms: number;
  method: string;
  path: string;
  status: number;
  ua: string | null;
  auth: 'bearer' | null;
  /** The `error` code of a JSON 4xx/5xx body, when the server sent one. */
  error: string | null;
  /** Response body size in bytes — counted for every response, never retained. Absent on ledgers written before it existed. */
  bytes?: number;
  /** Which content tier a write declared (`markup` | `dataset` | `viz` | `image`) — how a dataset upload is told from a document. */
  reqFormat?: string;
  /** For document writes: the markup sent and the markup echoed back. */
  reqMarkup?: string;
  resMarkup?: string;
  /**
   * The product answers `markup_changed:false` when storing did not alter the
   * document and then SKIPS the echo — so an absent `resMarkup` means agreement,
   * not silence. Without this, canonical_stable reads null for every clean write.
   */
  markupUnchanged?: boolean;
  /**
   * The artifact this request wrote to — from the URL, or from the response body
   * when the agent CREATED one (`POST /api/artifacts`) or wrote through `/mcp`.
   * An agent need not use the document the start link named, and one that does not
   * must still be scored on what it actually made.
   */
  artifactId?: string;
}
