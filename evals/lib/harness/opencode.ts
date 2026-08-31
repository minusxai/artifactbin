/**
 * OpenCode — `opencode run --format json --auto`. Config and state dirs are
 * pointed inside the run home (`OPENCODE_CONFIG_DIR` + the XDG dirs), the key
 * rides the provider's environment variable, and a custom base URL becomes an
 * `opencode.json` provider block. Usage and cost come per step on
 * `step_finish`; the CLI can exit before emitting the final one (upstream
 * #26855), which is telemetry unavailable — NOT a failed run.
 */
import { countDocsReads, type ToolInvocation } from '../docs-reads';
import fs from 'node:fs';
import path from 'node:path';
import type { HarnessAdapter, HarnessResult, HarnessRunContext, McpTarget, TokenUsage } from '../contracts';
import { copySkillsInto } from '../plugin-kit';
import { NO_TELEMETRY, parseJsonl } from './shared';

/**
 * The remote-server block, byte-for-byte what `opencode mcp add <name> --url <u>
 * --header "Authorization=Bearer <t>"` writes — verified by running it.
 */
export function mcpConfig(mcp: McpTarget): Record<string, unknown> {
  return { mcp: { [mcp.name]: { type: 'remote', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } };
}

export const opencode: HarnessAdapter & { mcpConfig: typeof mcpConfig } = {
  harness: 'opencode',
  supportsMcp: true,
  mcpConfig,

  /** Nothing to drop: a `text` event carries a whole part, and it is the only source of the final message. */
  keepLine(): boolean {
    return true;
  },

  async prepare(ctx: HarnessRunContext) {
    // OpenCode has no install command — it DISCOVERS skills from the project directory
    // (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`), so plugin mode means
    // copying them in beside the task's files. `--dir` already points it here.
    if (ctx.plugin) copySkillsInto(ctx.plugin, ctx.cwd);
    // OpenCode reads `$XDG_CONFIG_HOME/opencode/opencode.json` — where its own `mcp add` writes.
    const configPath = path.join(ctx.homeDir, 'xdg-config', 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (ctx.mcp) {
      fs.writeFileSync(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...mcpConfig(ctx.mcp) }, null, 2));
    }
  },

  invocation(ctx: HarnessRunContext) {
    const h = ctx.homeDir;
    return {
      // `--dir` is not optional: OpenCode otherwise resolves its own project root by walking up from
      // the process cwd, adopts whatever repository it finds, and never sees the files staged for the task.
      argv: ['opencode', 'run', '--format', 'json', '--auto', '--dir', ctx.cwd, '--model', ctx.leg.model, ctx.prompt],
      env: {
        OPENCODE_CONFIG_DIR: h,
        XDG_CONFIG_HOME: path.join(h, 'xdg-config'),
        XDG_DATA_HOME: path.join(h, 'xdg-data'),
        XDG_CACHE_HOME: path.join(h, 'xdg-cache'),
        XDG_STATE_HOME: path.join(h, 'xdg-state'),
        [ctx.leg.envVar]: ctx.apiKey,
      },
      unsetEnv: [],
    };
  },

  reduce(stdout: string): HarnessResult {
    const events = parseJsonl(stdout);
    let tokens: TokenUsage | null = null;
    let cost: number | null = null;
    let steps = 0;
    let toolCalls = 0;
    const invocations: ToolInvocation[] = [];
    let error: string | null = null;
    // A text PART may be re-emitted as it grows, carrying the accumulated text under the same id —
    // keyed by id (insertion-ordered), so the last version of each part wins instead of concatenating a part with itself.
    const texts = new Map<string, string>();
    for (const e of events) {
      const part = (e.part ?? {}) as Record<string, unknown>;
      if (e.type === 'step_finish') {
        steps += 1;
        const t = (part.tokens ?? {}) as { input?: number; output?: number; cache?: { read?: number; write?: number } };
        const add: TokenUsage = { input: t.input ?? 0, output: t.output ?? 0, cacheRead: t.cache?.read ?? 0, cacheWrite: t.cache?.write ?? 0 };
        tokens = tokens ? { input: tokens.input + add.input, output: tokens.output + add.output, cacheRead: tokens.cacheRead + add.cacheRead, cacheWrite: tokens.cacheWrite + add.cacheWrite } : add;
        if (typeof part.cost === 'number') cost = (cost ?? 0) + part.cost;
      } else if (e.type === 'text' && typeof part.text === 'string') {
        texts.set(typeof part.id === 'string' ? part.id : String(texts.size), part.text);
      } else if (e.type === 'tool' || e.type === 'tool_use' || e.type === 'tool_result') {
        if (e.type !== 'tool_result') {
          toolCalls += 1;
          const state = (part.state ?? {}) as { input?: unknown };
          invocations.push({ name: typeof part.tool === 'string' ? part.tool : '', input: state.input });
        }
      } else if (e.type === 'error') {
        error = (e.error as { message?: string } | undefined)?.message ?? JSON.stringify(e.error ?? e);
      }
    }
    if (events.length === 0) return { ok: false, error: 'no events in output', finalMessage: null, ...NO_TELEMETRY };
    return {
      ok: error === null,
      error,
      turns: steps || null,
      toolCalls,
      docsReadCalls: countDocsReads(invocations),
      tokens,
      reportedCostUsd: cost,
      webSearchCalls: null,
      finalMessage: texts.size ? [...texts.values()].join('') : null,
    };
  },
};
