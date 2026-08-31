/**
 * Claude Code — `claude -p --bare`. Bare mode skips CLAUDE.md, hooks, plugins
 * and MCP discovery, and needs an API key (no keychain): exactly the hermetic,
 * metered run an eval wants. The final `result` line carries turns, usage and
 * a cost figure — the latter is an estimate at Anthropic LIST prices, so it is
 * recorded but never used (see `price.ts`). An API error arrives as
 * `is_error: true` with `subtype: "success"`, so `is_error` is the verdict.
 */
import { countDocsReads, type ToolInvocation } from '../docs-reads';
import type { HarnessAdapter, HarnessResult, HarnessRunContext, TokenUsage } from '../contracts';
import { NO_TELEMETRY, parseJsonl } from './shared';

const NESTED_SESSION_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];

function usageOf(u: Record<string, unknown> | undefined): TokenUsage | null {
  if (!u) return null;
  return {
    input: Number(u.input_tokens ?? 0),
    cacheWrite: Number(u.cache_creation_input_tokens ?? 0),
    cacheRead: Number(u.cache_read_input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
  };
}

export const claudeCode: HarnessAdapter = {
  harness: 'claude-code',
  supportsMcp: true,

  /** `stream-json` interleaves per-token `stream_event` deltas; `reduce` reads only whole `assistant` and `result` lines. */
  keepLine(line: string): boolean {
    return !line.startsWith('{"type":"stream_event"');
  },

  async prepare() {
    // Nothing: the key rides the environment and the config dir is created by the CLI.
  },

  invocation(ctx: HarnessRunContext) {
    const env: Record<string, string> = { CLAUDE_CONFIG_DIR: ctx.homeDir, ANTHROPIC_API_KEY: ctx.apiKey };
    // `--strict-mcp-config` so ONLY this server is loaded: bare mode already skips discovery,
    // and an eval must not inherit whatever MCP servers the machine happens to have configured.
    const mcpArgs = ctx.mcp
      ? ['--mcp-config', JSON.stringify({ mcpServers: { [ctx.mcp.name]: { type: 'http', url: ctx.mcp.url, headers: { Authorization: `Bearer ${ctx.mcp.token}` } } } }), '--strict-mcp-config']
      : [];
    // `--bare` is GONE, and its absence is the same in every mode — which is the point.
    //
    // It skips CLAUDE.md, hooks, plugins and MCP discovery, and it is also the reason a plugin
    // cannot load: with `--bare`, "list your skills" answers with the TOOLS; without it, the
    // three artifact-bin skills are there. So plugin mode had to drop it — and making the flag
    // depend on the mode silently made the modes incomparable. Measured on a one-word prompt:
    // `--bare` is 1,735 tokens of base context, without it 20,189, and adding the plugin on top
    // is 20,206. The PLUGIN costs 17 tokens. The FLAG costs 18,454, on every turn.
    //
    // A whole production matrix misread that difference as "installed skill is 3.4× fetched skill"
    // when the plugin was very nearly free and the harness configuration was the entire gap.
    // Holding it constant is also the more honest baseline: nobody runs Claude Code `--bare`,
    // so the cheap column was measuring a setting no user has. Isolation now comes from what
    // does not vary with mode — a per-run `CLAUDE_CONFIG_DIR`, `--strict-mcp-config`, and a cwd
    // outside any repository.
    const pluginArgs = ctx.plugin ? ['--plugin-dir', ctx.plugin.pluginDir] : [];
    return {
      argv: [
        'claude', '-p', ...pluginArgs,
        '--model', ctx.leg.model,
        '--output-format', 'stream-json', '--verbose',
        '--max-turns', String(ctx.maxTurns),
        '--max-budget-usd', String(ctx.maxBudgetUsd),
        '--dangerously-skip-permissions',
        ...mcpArgs,
        ctx.prompt,
      ],
      env,
      unsetEnv: NESTED_SESSION_MARKERS,
      keepLine: claudeCode.keepLine,
    };
  },

  reduce(stdout: string): HarnessResult {
    const events = parseJsonl(stdout);
    // `--output-format json` is one object; stream-json ends with a `result` line. Accept both.
    const result = [...events].reverse().find((e) => e.type === 'result') ?? events.find((e) => 'is_error' in e);
    let toolCalls = 0;
    const invocations: ToolInvocation[] = [];
    for (const e of events) {
      if (e.type !== 'assistant') continue;
      const content = (e.message as { content?: Array<{ type: string; name?: string; input?: unknown }> } | undefined)?.content ?? [];
      for (const c of content) {
        if (c.type !== 'tool_use') continue;
        toolCalls += 1;
        invocations.push({ name: c.name ?? '', input: c.input });
      }
    }
    if (!result) {
      return { ok: false, error: 'no result event in output', finalMessage: null, ...NO_TELEMETRY };
    }
    const isError = result.is_error === true;
    const text = typeof result.result === 'string' ? result.result : null;
    return {
      ok: !isError,
      error: isError ? (text ?? `subtype ${String(result.subtype)}`) : null,
      turns: typeof result.num_turns === 'number' ? result.num_turns : null,
      toolCalls,
      docsReadCalls: countDocsReads(invocations),
      tokens: usageOf(result.usage as Record<string, unknown> | undefined),
      reportedCostUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
      webSearchCalls: null,
      finalMessage: isError ? null : text,
    };
  },
};
