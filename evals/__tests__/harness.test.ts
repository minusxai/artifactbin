/**
 * The four harness adapters, pinned against the REAL event streams each CLI
 * produced during planning (fixtures/*.jsonl|json). Two halves per adapter:
 *   invocation(ctx) — pure: argv + env for an unattended, hermetic run
 *   reduce(stdout)  — pure: the CLI's stream → one normalized HarnessResult
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { claudeCode } from '../lib/harness/claude-code';
import { codex } from '../lib/harness/codex';
import { pi } from '../lib/harness/pi';
import { opencode } from '../lib/harness/opencode';
import { adapterFor } from '../lib/harness';
import type { HarnessRunContext } from '../lib/contracts';
import type { Leg } from '../lib/leg';
import { planMode } from '../lib/mode';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

function ctx(leg: Partial<Leg> & Pick<Leg, 'harness' | 'model'>): HarnessRunContext {
  return {
    leg: { envVar: 'SOME_API_KEY', apiKey: 'the-secret', label: leg.harness, price: null, vision: true, mode: planMode(leg.harness, 'fetched_skill+api_action'), ...leg },
    prompt: 'Do the thing.\n\nHelp me create an artifact. Follow instructions at http://127.0.0.1:3101/a/abc123/start?k=s',
    cwd: '/tmp/run/cwd',
    homeDir: '/tmp/run/home',
    apiKey: 'the-secret',
    maxTurns: 40,
    maxBudgetUsd: 3,
  };
}

describe('adapterFor', () => {
  it('maps every harness name to its adapter', () => {
    for (const h of ['claude-code', 'codex', 'pi', 'opencode'] as const) expect(adapterFor(h).harness).toBe(h);
  });
});

describe('claude-code', () => {
  const c = ctx({ harness: 'claude-code', model: 'claude-opus-5', envVar: 'ANTHROPIC_API_KEY' });

  /**
   * Isolation here is the per-run `CLAUDE_CONFIG_DIR`, `--strict-mcp-config` and a cwd outside
   * any repository — deliberately NOT `--bare`, which cannot be used with installed skills and so
   * cannot be used in any mode without making the comparison meaningless (`harness/claude-code.ts`).
   */
  it('runs non-interactive, with a turn and budget cap, isolated config dir, key from env, no nested-session marker', () => {
    const inv = claudeCode.invocation(c);
    expect(inv.argv[0]).toBe('claude');
    expect(inv.argv).not.toContain('--bare');
    expect(inv.argv).toEqual(expect.arrayContaining(['-p', '--model', 'claude-opus-5', '--output-format', 'stream-json', '--verbose', '--max-turns', '40', '--max-budget-usd', '3', '--dangerously-skip-permissions']));
    expect(inv.argv.at(-1)).toBe(c.prompt);
    expect(inv.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/tmp/run/home', ANTHROPIC_API_KEY: 'the-secret' });
    expect(inv.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(inv.unsetEnv).toEqual(expect.arrayContaining(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']));
  });

  it('reduces the real result object: turns, tokens, reported cost, final text', () => {
    const r = claudeCode.reduce(fx('claude-code.result.json'));
    // Only Codex counts provider-side searches; null here means "no such item", never "none made".
    expect(r.webSearchCalls).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.turns).toBe(1);
    expect(r.tokens).toEqual({ input: 2, cacheWrite: 1646, cacheRead: 0, output: 4 });
    expect(r.reportedCostUsd).toBeCloseTo(0.0103975, 6);
    expect(r.finalMessage).toBe('ok');
    expect(r.toolCalls).toBe(0);
  });

  it('an API error is is_error, not subtype — the run is not ok and the message is kept', () => {
    const r = claudeCode.reduce(fx('claude-code.error.json'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Credit balance/);
    expect(r.tokens).toEqual({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  });

  it('reads a stream-json transcript: the last result line wins, tool_use blocks are counted', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Bash', input: {} }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: {} }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: 'done', total_cost_usd: 0.5, usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 } }),
    ].join('\n');
    const r = claudeCode.reduce(stream);
    expect(r).toMatchObject({ ok: true, turns: 3, toolCalls: 2, finalMessage: 'done', reportedCostUsd: 0.5, tokens: { input: 10, cacheWrite: 20, cacheRead: 30, output: 40 } });
  });

  it('no result line at all → not ok, telemetry null', () => {
    const r = claudeCode.reduce('');
    expect(r.ok).toBe(false);
    expect(r.tokens).toBeNull();
  });
});

describe('codex', () => {
  const c = ctx({ harness: 'codex', model: 'gpt-5.6-terra', envVar: 'OPENAI_API_KEY' });

  /**
   * MEASURED against a live MCP server, four ways: with Codex's sandbox the approval policy
   * defaults to `never`, and `never` CANCELS an MCP tool call rather than running it
   * ("MCP tool call requires approval, but approval policy is never"). `-a on-request` never
   * attempts the call at all and per-server `trusted_tools` is still cancelled; only the bypass
   * flag lets it through. Codex had never once published on the mcp task because of this.
   */
  it('runs exec --json in an isolated CODEX_HOME, with approvals bypassed so its MCP tools can fire', () => {
    const inv = codex.invocation(c);
    expect(inv.argv.slice(0, 2)).toEqual(['codex', 'exec']);
    expect(inv.argv).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '-m', 'gpt-5.6-terra', '--dangerously-bypass-approvals-and-sandbox']));
    // The sandbox is gone, so its two workarounds go with it: the network it denied by default,
    // and bubblewrap failing to launch on GitHub runners.
    expect(inv.argv).not.toContain('--sandbox');
    expect(inv.argv.join(' ')).not.toContain('sandbox_workspace_write');
    expect(inv.argv.at(-1)).toBe(c.prompt);
    expect(inv.env.CODEX_HOME).toBe('/tmp/run/home');
    // The key does NOT ride the environment: Codex ignores it there — prepare() logs it in.
    expect(inv.env.OPENAI_API_KEY).toBeUndefined();
  });

  it('reduces the real stream: one turn, usage split into cached and uncached input', () => {
    const r = codex.reduce(fx('codex.events.jsonl'));
    expect(r.ok).toBe(true);
    expect(r.turns).toBe(1);
    // OpenAI's input_tokens INCLUDES the tokens written to cache; billing them again at the input rate doubled every Codex run.
    expect(r.tokens).toEqual({ input: 3, cacheRead: 0, cacheWrite: 11731, output: 5 });
    expect(r.webSearchCalls).toBe(0);
    expect(r.finalMessage).toBe('ok');
    expect(r.reportedCostUsd).toBeNull();
    expect(r.toolCalls).toBe(0);
  });

  it('splits input_tokens into ordinary, cached and cache-written — OpenAI counts both INSIDE the total', () => {
    const r = codex.reduce(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 35, output_tokens: 7 } }));
    expect(r.tokens).toEqual({ input: 25, cacheRead: 40, cacheWrite: 35, output: 7 });
  });

  it('counts web_search items — OpenAI bills them per CALL, which no usage object carries', () => {
    // A real line from a production run: the agent "searching" the start link itself.
    const search = '{"type":"item.completed","item":{"id":"item_1","type":"web_search","id":"exec-787ddc80","query":"https://artifactbin.dev/a/N1u5dg/start?k=x","action":{"type":"other"}}}';
    const turn = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1 } });
    const r = codex.reduce([search, search, turn].join('\n'));
    expect(r.webSearchCalls).toBe(2);
    expect(r.toolCalls).toBe(2);
  });

  it('a failed turn is not ok and carries the last error message', () => {
    const r = codex.reduce(fx('codex.error.jsonl'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it('counts command, MCP, file-change and web-search items as tool calls across turns', () => {
    const lines = [
      { type: 'item.completed', item: { type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { type: 'reasoning' } },
      { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'x', tool: 'y' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1 } },
      { type: 'item.completed', item: { type: 'file_change' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'final' } },
      { type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 3 } },
    ].map((l) => JSON.stringify(l)).join('\n');
    const r = codex.reduce(lines);
    expect(r).toMatchObject({ ok: true, turns: 2, toolCalls: 3, finalMessage: 'final', tokens: { input: 3, output: 4 } });
  });
});

describe('pi', () => {
  const c = ctx({ harness: 'pi', model: 'fireworks/accounts/fireworks/models/deepseek-v4-flash-0731', envVar: 'FIREWORKS_API_KEY' });

  it('runs print+json, fully hermetic, with its state dir and session dir inside the run home, key under the provider variable', () => {
    const inv = pi.invocation(c);
    expect(inv.argv[0]).toBe('pi');
    expect(inv.argv).toEqual(expect.arrayContaining(['-p', '--mode', 'json', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-session', '--model', c.leg.model]));
    expect(inv.argv).toContain('--session-dir');
    expect(inv.argv[inv.argv.indexOf('--session-dir') + 1]).toBe(path.join('/tmp/run/home', 'sessions'));
    expect(inv.argv.at(-1)).toBe(c.prompt);
    expect(inv.env).toMatchObject({ PI_CODING_AGENT_DIR: '/tmp/run/home', FIREWORKS_API_KEY: 'the-secret' });
  });

  it('reduces the real Fireworks stream: usage from the assistant message_end', () => {
    const r = pi.reduce(fx('pi.events.jsonl'));
    expect(r.webSearchCalls).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.turns).toBe(1);
    expect(r.tokens).toEqual({ input: 1678, cacheRead: 0, cacheWrite: 0, output: 14 });
    expect(r.reportedCostUsd).toBeCloseTo(0.0016501, 6);
    expect(r.finalMessage?.toLowerCase()).toContain('ok');
  });

  it('a model error is stopReason "error" with exit 0 — the run is NOT ok', () => {
    const r = pi.reduce(fx('pi.error.jsonl'));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.tokens).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  });

  it('counts toolCall blocks and sums usage over every assistant message', () => {
    const msg = (content: unknown[], usage: Record<string, number>) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', content, usage: { ...usage, cost: { total: 0 } }, stopReason: 'stop', model: 'm', provider: 'p' } });
    const stream = [
      msg([{ type: 'toolCall', name: 'bash' }], { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11 }),
      JSON.stringify({ type: 'turn_end' }),
      msg([{ type: 'text', text: 'done' }], { input: 5, output: 2, cacheRead: 3, cacheWrite: 0, totalTokens: 10 }),
      JSON.stringify({ type: 'turn_end' }),
    ].join('\n');
    const r = pi.reduce(stream);
    expect(r).toMatchObject({ ok: true, turns: 2, toolCalls: 1, finalMessage: 'done', tokens: { input: 15, output: 3, cacheRead: 3, cacheWrite: 0 } });
  });
});

describe('opencode', () => {
  const c = ctx({ harness: 'opencode', model: 'fireworks-ai/accounts/fireworks/models/minimax-m3', envVar: 'FIREWORKS_API_KEY' });

  it('runs headless json with auto-approval, config and data dirs inside the run home, key under the provider variable', () => {
    const inv = opencode.invocation(c);
    expect(inv.argv.slice(0, 2)).toEqual(['opencode', 'run']);
    expect(inv.argv).toEqual(expect.arrayContaining(['--format', 'json', '--auto', '--model', c.leg.model]));
    expect(inv.argv.at(-1)).toBe(c.prompt);
    expect(inv.env).toMatchObject({ OPENCODE_CONFIG_DIR: '/tmp/run/home', FIREWORKS_API_KEY: 'the-secret' });
    for (const k of ['XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME']) expect(inv.env[k]?.startsWith('/tmp/run/home')).toBe(true);
  });

  it('reduces the real stream: tokens and cost from step_finish', () => {
    const r = opencode.reduce(fx('opencode.events.jsonl'));
    expect(r.ok).toBe(true);
    expect(r.turns).toBe(1);
    expect(r.tokens).toEqual({ input: 8633, output: 4, cacheRead: 78, cacheWrite: 0 });
    expect(r.reportedCostUsd).toBeCloseTo(0.00262218, 6);
    expect(r.finalMessage?.toLowerCase()).toContain('ok');
  });

  it('a stream cut before step_finish is still a completed run with NO telemetry (upstream bug), never a failure', () => {
    const r = opencode.reduce(JSON.stringify({ type: 'text', part: { text: 'partial' } }));
    expect(r.ok).toBe(true);
    expect(r.tokens).toBeNull();
    expect(r.turns).toBeNull();
  });

  it('an error event makes the run not ok; tool events are counted', () => {
    const lines = [
      { type: 'tool_use', part: { tool: 'bash' } },
      { type: 'tool', part: { tool: 'webfetch' } },
      { type: 'step_finish', part: { tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.1 } },
      { type: 'error', error: { message: 'boom' } },
    ].map((l) => JSON.stringify(l)).join('\n');
    const r = opencode.reduce(lines);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
    expect(r.toolCalls).toBe(2);
  });

  it('takes the LAST text per part id — a part that updates as it streams must not be concatenated with itself', () => {
    const lines = [
      { type: 'text', part: { id: 'prt_1', text: 'Hel' } },
      { type: 'text', part: { id: 'prt_1', text: 'Hello wor' } },
      { type: 'text', part: { id: 'prt_1', text: 'Hello world' } },
      { type: 'text', part: { id: 'prt_2', text: '!' } },
      { type: 'step_finish', part: { tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } }, cost: 0.1 } },
    ].map((l) => JSON.stringify(l)).join('\n');
    expect(opencode.reduce(lines).finalMessage).toBe('Hello world!');
  });

});

describe('stream filtering (a transcript must not grow without bound)', () => {
  it('pi drops the per-token message_update firehose and keeps what reduce() reads', () => {
    expect(pi.keepLine!(JSON.stringify({ type: 'message_update', message: { content: 'x'.repeat(1000) } }))).toBe(false);
    expect(pi.keepLine!(JSON.stringify({ type: 'message_end', message: { role: 'assistant' } }))).toBe(true);
    expect(pi.keepLine!(JSON.stringify({ type: 'turn_end' }))).toBe(true);
    expect(pi.keepLine!('not json')).toBe(true);
  });

  it('claude-code drops partial stream_event deltas, keeps assistant and result lines', () => {
    expect(claudeCode.keepLine!(JSON.stringify({ type: 'stream_event', event: { delta: { text: 'a' } } }))).toBe(false);
    expect(claudeCode.keepLine!(JSON.stringify({ type: 'assistant', message: { content: [] } }))).toBe(true);
    expect(claudeCode.keepLine!(JSON.stringify({ type: 'result', is_error: false }))).toBe(true);
  });

  it('opencode keeps text parts — they ARE the final message — and relies on the byte cap', () => {
    expect(opencode.keepLine!(JSON.stringify({ type: 'text', part: { text: 'hello' } }))).toBe(true);
    expect(opencode.keepLine!(JSON.stringify({ type: 'step_finish', part: {} }))).toBe(true);
  });
});

describe('MCP transport support', () => {
  const mcp = { name: 'artifact-bin', url: 'http://127.0.0.1:3101/mcp', token: 'mx_secret' };

  it('says which harnesses can speak MCP at all — Pi ships none', () => {
    expect(claudeCode.supportsMcp).toBe(true);
    expect(codex.supportsMcp).toBe(true);
    expect(opencode.supportsMcp).toBe(true);
    // Pi is a minimal harness: no MCP in its CLI, its docs, or its settings.
    expect(pi.supportsMcp).toBe(false);
  });

  it('claude-code passes the server inline and refuses any other one', () => {
    const inv = claudeCode.invocation({ ...ctx({ harness: 'claude-code', model: 'claude-opus-5' }), mcp });
    const i = inv.argv.indexOf('--mcp-config');
    expect(i).toBeGreaterThan(-1);
    expect(JSON.parse(inv.argv[i + 1])).toEqual({
      mcpServers: { 'artifact-bin': { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } },
    });
    expect(inv.argv).toContain('--strict-mcp-config');
  });

  it('claude-code passes no MCP flags for a REST task', () => {
    expect(claudeCode.invocation(ctx({ harness: 'claude-code', model: 'claude-opus-5' })).argv).not.toContain('--mcp-config');
  });

  it('codex reads the bearer token from an env var, so it never lands in config.toml', () => {
    const inv = codex.invocation({ ...ctx({ harness: 'codex', model: 'gpt-5.6-terra' }), mcp });
    expect(inv.env.ARTIFACT_BIN_MCP_TOKEN).toBe('mx_secret');
  });

  it('opencode writes the remote-server block the CLI itself writes', () => {
    expect(opencode.mcpConfig(mcp)).toEqual({
      mcp: { 'artifact-bin': { type: 'remote', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } },
    });
  });
});

describe('working directory', () => {
  it('opencode is TOLD its directory — it otherwise walks up to the nearest project root and loses the staged files', () => {
    const inv = opencode.invocation(ctx({ harness: 'opencode', model: 'fireworks-ai/x' }));
    expect(inv.argv).toEqual(expect.arrayContaining(['--dir', '/tmp/run/cwd']));
  });
});
