/**
 * Codex — `codex exec --json`. Two things learned by running it: the key does
 * NOT ride the environment (a fresh `CODEX_HOME` with `OPENAI_API_KEY` set gets
 * a 401 on the Responses websocket) — `prepare()` runs `codex login
 * --with-api-key` from stdin into that home instead; and it reads stdin unless
 * stdin is closed, so the driver spawns it with stdin ignored. A THIRD was found
 * by running the matrix: `--sandbox workspace-write` denies NETWORK access by
 * default, so the agent could not reach the product at all — both its tasks ended
 * after one turn with zero HTTP calls. `sandbox_workspace_write.network_access`
 * turns it on; an eval agent must be able to publish. Usage comes per
 * turn on `turn.completed`; OpenAI counts BOTH cached and cache-written tokens
 * INSIDE `input_tokens` (its own formula: ordinary + cached × rate + written × rate),
 * so both are subtracted to get the ordinary figure — subtracting only cached
 * billed every cache write twice, which on a Codex turn is nearly all of it.
 * It reports no cost, and a `web_search` item is a per-call fee the usage
 * object never carries, so those are counted for `taskCost` to price.
 *
 * A FOURTH: what this adapter reports as `turns` is NOT Codex's own turn count.
 * Codex emits exactly one `turn.started`/`turn.completed` pair per user prompt,
 * so a whole run read `turns: 1` beside 16 tool calls (production run 33702277600,
 * 2026-09-03) — meaningless beside Claude Code's `turns`, which is its count of
 * assistant messages. The comparable Codex figure is the number of assistant
 * ITEMS it emitted (`ASSISTANT_ITEMS` below), so that is what the report gets.
 * `turn.completed` still drives token accumulation and `ok`: turns is telemetry,
 * `ok` is completion, and neither is read off the other.
 */
import { countDocsReads, type ToolInvocation } from '../docs-reads';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { HarnessAdapter, HarnessResult, HarnessRunContext, TokenUsage } from '../contracts';
import { NO_TELEMETRY, parseJsonl } from './shared';


const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'file_change', 'web_search']);

/** Every item type Codex emits as the ASSISTANT acting — its count is the run's `turns`. Superset of `TOOL_ITEMS`. */
const ASSISTANT_ITEMS = new Set(['agent_message', 'reasoning', 'command_execution', 'file_change', 'web_search', 'mcp_tool_call']);

export const codex: HarnessAdapter = {
  harness: 'codex',

  /** The same items `reduce` counts as `turns`: `codex exec --help` offers no cap of its own. */
  countsAsTurn(line: string): boolean {
    if (!line.includes('"item.completed"')) return false;
    const type = (parseJsonl(line)[0]?.item as { type?: string } | undefined)?.type;
    return type !== undefined && ASSISTANT_ITEMS.has(type);
  },

  async prepare(ctx: HarnessRunContext) {
    fs.mkdirSync(ctx.homeDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const child = spawn('codex', ['login', '--with-api-key'], {
        env: { ...process.env, CODEX_HOME: ctx.homeDir },
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (c) => (err += c));
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`codex login failed (${code}): ${err.trim()}`))));
      child.stdin.end(ctx.apiKey);
    });
    // Skills, when installed, sit under `$CODEX_HOME/skills`, where Codex discovers them itself.
  },

  invocation(ctx: HarnessRunContext) {
    const env: Record<string, string> = { CODEX_HOME: ctx.homeDir };
    return {
      argv: [
        'codex', 'exec', '--json', '--skip-git-repo-check',
        '-m', ctx.leg.model,
        // Codex's own sandbox is off, and this is the flag that turns MCP on.
        //
        // With the sandbox, the approval policy defaults to `never`, and `never` does not mean
        // "run it": an MCP tool call that wants approval is CANCELLED — `MCP tool call requires
        // approval, but approval policy is never`. Codex answered the mcp task in one turn with
        // the URL it had been given, having published nothing, in every matrix we ever ran.
        // Measured against a live server: default and `-a on-request` and per-server
        // `trusted_tools` all leave the call blocked; this flag lets it through.
        //
        // Dropping the sandbox also retires the whole class of failure it caused — network access
        // denied by default (both codex tasks once ended after one turn with zero HTTP calls), and
        // bubblewrap unable to launch under AppArmor on GitHub runners, where EVERY shell command
        // failed with exit 1 and no output. The flag is documented for "environments that are
        // externally sandboxed", which a disposable CI runner is; the honest cost is that a LOCAL
        // run now trusts codex with the machine, the same trust the other three harnesses already
        // get (`--dangerously-skip-permissions`, `--auto`).
        //
        // Uniform across every task and mode, deliberately: a permission that varies with what is
        // being compared puts the harness's configuration inside the comparison, which is the
        // mistake `--bare` already taught once.
        '--dangerously-bypass-approvals-and-sandbox',
        '-o', path.join(ctx.homeDir, 'last-message.md'),
        ctx.prompt,
      ],
      env,
      unsetEnv: [],
    };
  },

  reduce(stdout: string): HarnessResult {
    const events = parseJsonl(stdout);
    let tokens: TokenUsage | null = null;
    let turnsCompleted = 0;
    let turns = 0;
    let toolCalls = 0;
    let webSearchCalls = 0;
    const invocations: ToolInvocation[] = [];
    let finalMessage: string | null = null;
    let error: string | null = null;
    let failed = false;
    for (const e of events) {
      if (e.type === 'turn.completed') {
        turnsCompleted += 1;
        const u = (e.usage ?? {}) as Record<string, number>;
        const cached = Number(u.cached_input_tokens ?? 0);
        const written = Number(u.cache_write_input_tokens ?? 0);
        const add: TokenUsage = {
          input: Number(u.input_tokens ?? 0) - cached - written,
          cacheRead: cached,
          cacheWrite: written,
          output: Number(u.output_tokens ?? 0),
        };
        tokens = tokens
          ? { input: tokens.input + add.input, cacheRead: tokens.cacheRead + add.cacheRead, cacheWrite: tokens.cacheWrite + add.cacheWrite, output: tokens.output + add.output }
          : add;
      } else if (e.type === 'item.completed') {
        const item = (e.item ?? {}) as { type?: string; text?: string; command?: string; url?: string; query?: string };
        if (item.type && ASSISTANT_ITEMS.has(item.type)) turns += 1;
        if (item.type && TOOL_ITEMS.has(item.type)) {
          toolCalls += 1;
          invocations.push({ name: item.type, input: item.command ?? item.url ?? item.query ?? '' });
        }
        if (item.type === 'web_search') webSearchCalls += 1;
        if (item.type === 'agent_message' && typeof item.text === 'string') finalMessage = item.text;
      } else if (e.type === 'turn.failed') {
        failed = true;
        const msg = (e.error as { message?: string } | undefined)?.message;
        if (msg) error = msg;
      } else if (e.type === 'error' && typeof e.message === 'string') {
        error = e.message;
      }
    }
    if (events.length === 0) return { ok: false, error: 'no events in output', finalMessage: null, ...NO_TELEMETRY };
    const ok = !failed && turnsCompleted > 0;
    return { ok, error: ok ? null : (error ?? 'no turn completed'), turns: turns || null, toolCalls, docsReadCalls: countDocsReads(invocations), invocations, tokens, reportedCostUsd: null, webSearchCalls, finalMessage };
  },
};
