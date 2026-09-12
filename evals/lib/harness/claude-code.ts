/**
 * Claude Code — `claude -p`, deliberately NOT `--bare`: bare mode cannot load installed skills, and
 * the skills are the product surface under test. Isolation is the per-run `CLAUDE_CONFIG_DIR`, the
 * empty strict MCP config and a cwd outside any repository (see the harness test). Claude Code's own
 * bundled skills (`dataviz`) therefore load too — an agent reading them is the harness its users hold. The final `result` line carries turns, usage and
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

  /** `stream-json` interleaves per-token `stream_event` deltas; `reduce` reads only whole `assistant` and `result` lines. */
  keepLine(line: string): boolean {
    return !line.startsWith('{"type":"stream_event"');
  },

  /**
   * One assistant message is one step. Claude's own `num_turns` also counts the user turns that carry
   * tool results, so this is the smaller number of the two — which is what a BACKSTOP wants: the
   * native `--max-turns` stops the run first, and the driver only fires if it did not.
   */
  countsAsTurn(line: string): boolean {
    return line.startsWith('{"type":"assistant"');
  },
  /** One API message is one turn, however many content blocks it streamed as separate lines. */
  turnKey(line: string): string | null {
    if (!line.startsWith('{"type":"assistant"')) return null;
    const id = (parseJsonl(line)[0]?.message as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id ? id : null;
  },

  async prepare() {
    // Nothing: the key rides the environment and the config dir is created by the CLI.
  },

  invocation(ctx: HarnessRunContext) {
    const env: Record<string, string> = { CLAUDE_CONFIG_DIR: ctx.homeDir, ANTHROPIC_API_KEY: ctx.apiKey };
    // Empty strict config prevents inheriting unrelated servers from the user's machine.
    // `--mcp-config <configs...>` is VARIADIC (Claude Code 2.1.269): without the `--`
    // terminator it swallows the prompt as a second config path and the CLI exits before
    // the agent starts — "MCP config file not found: <cwd>/<prompt>" (run 34694871143).
    return {
      argv: [
        'claude', '-p',
        '--model', ctx.leg.model,
        '--output-format', 'stream-json', '--verbose',
        '--max-turns', String(ctx.maxTurns),
        '--max-budget-usd', String(ctx.maxBudgetUsd),
        '--dangerously-skip-permissions',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--', ctx.prompt,
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
      invocations,
      tokens: usageOf(result.usage as Record<string, unknown> | undefined),
      reportedCostUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
      webSearchCalls: null,
      finalMessage: isError ? null : text,
    };
  },
};
