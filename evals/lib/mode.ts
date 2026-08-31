/**
 * The eval treatment has two independent axes:
 *
 *   skill source: fetched_skill | installed_skill
 *   actions:      api_action    | mcp_action
 *
 * Keeping both axes in the mode name prevents a connected MCP server from
 * being mistaken for installed vocabulary, and prevents an installed skill
 * from implying which action transport its contents teach.
 */
import type { Harness } from './contracts';

export const EVAL_MODES = ['fetched_skill+api_action', 'fetched_skill+mcp_action', 'installed_skill+api_action', 'installed_skill+mcp_action'] as const;
export type EvalMode = (typeof EVAL_MODES)[number];
export type SkillSource = 'fetched_skill' | 'installed_skill';
export type ActionTransport = 'api' | 'mcp';

export const DEFAULT_MODE: EvalMode = 'fetched_skill+api_action';

export interface ModePlan {
  /** What was asked for on the command line. */
  asked: EvalMode;
  /** What this harness can actually run. */
  run: EvalMode;
  /** Why `run` differs from `asked`; null when it does not. */
  substitutedWhy: string | null;
}

/** Harnesses that can speak MCP. Pi ships no MCP client. */
const SPEAKS_MCP: Record<Harness, boolean> = {
  'claude-code': true,
  codex: true,
  pi: false,
  opencode: true,
};

export function parseMode(raw: string): EvalMode {
  if (!(EVAL_MODES as readonly string[]).includes(raw)) {
    throw new Error(`unknown --mode "${raw}" — known: ${EVAL_MODES.join(', ')}`);
  }
  return raw as EvalMode;
}

export function skillSource(mode: EvalMode): SkillSource {
  return mode.startsWith('installed_skill+') ? 'installed_skill' : 'fetched_skill';
}

export function actionTransport(mode: EvalMode): ActionTransport {
  return mode.endsWith('+mcp_action') ? 'mcp' : 'api';
}

export function modeFor(source: SkillSource, actions: ActionTransport): EvalMode {
  return `${source}+${actions}_action` as EvalMode;
}

export function planMode(harness: Harness, asked: EvalMode): ModePlan {
  if (actionTransport(asked) === 'mcp' && !SPEAKS_MCP[harness]) {
    const run = modeFor(skillSource(asked), 'api');
    return {
      asked,
      run,
      substitutedWhy: `${harness} ships no MCP client — kept ${skillSource(asked)} delivery and ran API actions`,
    };
  }
  return { asked, run: asked, substitutedWhy: null };
}

export function installsSkills(mode: EvalMode): boolean {
  return skillSource(mode) === 'installed_skill';
}

export function fetchesSkills(mode: EvalMode): boolean {
  return skillSource(mode) === 'fetched_skill';
}

export function connectsMcp(mode: EvalMode): boolean {
  return actionTransport(mode) === 'mcp';
}

export interface TransportPlan {
  run: ActionTransport;
  asked: ActionTransport;
  substitutedWhy: string | null;
}

export function planTransport(harness: Harness, asked: ActionTransport): TransportPlan {
  if (asked === 'mcp' && !SPEAKS_MCP[harness]) {
    return { asked, run: 'api', substitutedWhy: `${harness} ships no MCP client — ran the same task through API actions` };
  }
  return { asked, run: asked, substitutedWhy: null };
}
