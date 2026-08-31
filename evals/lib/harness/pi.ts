/**
 * Pi — `pi -p --mode json`, with every discovery switched off (extensions,
 * skills, prompt templates, AGENTS.md/CLAUDE.md) and an ephemeral session in
 * the run's own dir. The model is `provider/id` in Pi's notation; a Fireworks id
 * missing from Pi's catalog passes through as a custom id with a warning. Pi
 * emits a `message_update` per TOKEN carrying the whole message so far, which is
 * quadratic in the document being authored (a 541 MB transcript, then EPIPE) and
 * is dropped by `keepLine` — `reduce` reads only `message_end` and `turn_end`. Pi
 * EXITS 0 on a model error — the assistant message says `stopReason: "error"` —
 * so the verdict is read from the messages, never the exit code. Its `cost` is
 * Pi's own pricing table (a fallback rate for custom ids): recorded, not used.
 */
import { countDocsReads, type ToolInvocation } from '../docs-reads';
import type { HarnessAdapter, HarnessResult, HarnessRunContext, TokenUsage } from '../contracts';
import { NO_TELEMETRY, parseJsonl } from './shared';
import path from 'node:path';

interface PiAssistant {
  role: string;
  content?: Array<{ type: string; text?: string; name?: string; arguments?: unknown }>;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
  stopReason?: string;
  errorMessage?: string;
}

export const pi: HarnessAdapter = {
  harness: 'pi',
  /** Pi ships no MCP client — mode planning preserves skill delivery and substitutes API actions. */
  supportsMcp: false,

  keepLine(line: string): boolean {
    return !line.startsWith('{"type":"message_update"');
  },

  async prepare() {
    // Nothing: the key rides the provider's environment variable.
  },

  invocation(ctx: HarnessRunContext) {
    return {
      argv: [
        'pi', '-p', '--mode', 'json',
        // `--skill <path>` is repeatable and takes a directory; `--no-skills` would disable the
        // lot, so it is exactly the flag plugin mode replaces. Pi needs no extension for this.
        '--no-extensions',
        ...(ctx.plugin ? ctx.plugin.skillDirs.flatMap((d) => ['--skill', d]) : ['--no-skills']),
        '--no-prompt-templates', '--no-context-files', '--no-session',
        '--session-dir', path.join(ctx.homeDir, 'sessions'),
        '--model', ctx.leg.model,
        ctx.prompt,
      ],
      env: { PI_CODING_AGENT_DIR: ctx.homeDir, [ctx.leg.envVar]: ctx.apiKey },
      unsetEnv: [],
      keepLine: pi.keepLine,
    };
  },

  reduce(stdout: string): HarnessResult {
    const events = parseJsonl(stdout);
    const assistants = events
      .filter((e) => e.type === 'message_end' && (e.message as PiAssistant | undefined)?.role === 'assistant')
      .map((e) => e.message as PiAssistant);
    const turns = events.filter((e) => e.type === 'turn_end').length;
    if (assistants.length === 0) return { ok: false, error: 'no assistant message in output', finalMessage: null, ...NO_TELEMETRY };
    let tokens: TokenUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    let cost = 0;
    let toolCalls = 0;
    const invocations: ToolInvocation[] = [];
    for (const m of assistants) {
      const u = m.usage ?? {};
      tokens = { input: tokens.input + (u.input ?? 0), cacheRead: tokens.cacheRead + (u.cacheRead ?? 0), cacheWrite: tokens.cacheWrite + (u.cacheWrite ?? 0), output: tokens.output + (u.output ?? 0) };
      cost += u.cost?.total ?? 0;
      for (const c of m.content ?? []) {
        if (c.type !== 'toolCall') continue;
        toolCalls += 1;
        invocations.push({ name: c.name ?? '', input: c.arguments });
      }
    }
    const last = assistants[assistants.length - 1];
    const errored = last.stopReason === 'error';
    const text = (last.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n') || null;
    return {
      ok: !errored,
      error: errored ? (last.errorMessage ?? 'model error') : null,
      turns: turns || null,
      toolCalls,
      docsReadCalls: countDocsReads(invocations),
      tokens,
      reportedCostUsd: cost,
      webSearchCalls: null,
      finalMessage: errored ? null : text,
    };
  },
};
