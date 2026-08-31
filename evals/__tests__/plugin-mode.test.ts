/**
 * `installed_skill`: the vocabulary is local to the harness instead of
 * being read out of the product. Every one of these four facts was established
 * by running the CLI, not by reading its docs — they are the reason the mode
 * needs a per-harness answer at all.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapterFor } from '../lib/harness';
import { pluginInstallCommands } from '../lib/harness/codex';
import { materializePlugin, copySkillsInto, type PluginKit } from '../lib/plugin-kit';
import { planMode } from '../lib/mode';
import { buildPrompt } from '../lib/tasks';
import { gatedChecks } from '../lib/score/verdict';
import type { HarnessRunContext } from '../lib/contracts';
import type { Harness } from '../lib/contracts';

let kit: PluginKit;
let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-kit-'));
  kit = materializePlugin(path.join(root, 'market'), 'https://example.test');
});

function ctx(harness: Harness, withPlugin: boolean): HarnessRunContext {
  return {
    leg: {
      harness, model: 'm', envVar: 'SOME_API_KEY', apiKey: 'k', label: harness,
      price: null, vision: true, mode: planMode(harness, withPlugin ? 'installed_skill+api_action' : 'fetched_skill+api_action'),
    },
    prompt: 'do it',
    cwd: path.join(root, 'cwd'),
    homeDir: path.join(root, 'home'),
    apiKey: 'k',
    maxTurns: 10,
    maxBudgetUsd: 1,
    ...(withPlugin ? { plugin: kit } : {}),
  };
}

describe('materializePlugin', () => {
  it('writes the MARKETPLACE layout — Codex installs from one and refuses a bare plugin dir', () => {
    expect(fs.existsSync(path.join(kit.marketplaceDir, '.claude-plugin', 'marketplace.json'))).toBe(true);
    expect(fs.existsSync(path.join(kit.pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('bakes the base it was given into the skill, so a task\'s traffic reaches its own proxy', () => {
    const skill = fs.readFileSync(path.join(kit.pluginDir, 'skills', 'artifact-bin', 'SKILL.md'), 'utf8');
    expect(skill).toContain('https://example.test');
    expect(skill).not.toContain('artifactbin.dev');
  });

  it('names each skill directory, for a harness that loads them one at a time', () => {
    expect(kit.skillDirs.map((d) => path.basename(d)).sort()).toEqual(['artifact-bin']);
  });
});

describe('claude-code', () => {
  /**
   * `--bare` skips CLAUDE.md, hooks, plugins and MCP discovery — which is what
   * makes the ordinary run hermetic, and is ALSO what stops a plugin loading.
   * Verified against the CLI: with `--bare` it lists its tools when asked for
   * its skills; without it, the three artifact-bin skills are there. It still
   * authenticates from the API key alone either way.
   */
  it('never passes --bare, in ANY mode — the flag must not vary with what is being compared', () => {
    const withPlugin = adapterFor('claude-code').invocation(ctx('claude-code', true)).argv;
    expect(withPlugin).not.toContain('--bare');
    expect(withPlugin).toContain('--plugin-dir');
    expect(withPlugin[withPlugin.indexOf('--plugin-dir') + 1]).toBe(kit.pluginDir);

    // Measured on a one-word prompt: `--bare` is 1,735 tokens of base context and dropping it
    // is 20,189 — so a mode-dependent flag put an 18,454-token-per-turn difference inside a
    // comparison that was supposed to be about the plugin (which costs 17).
    expect(adapterFor('claude-code').invocation(ctx('claude-code', false)).argv).not.toContain('--bare');
  });
});

describe('pi', () => {
  /** Pi's flag is `--skill <path>`, repeatable — and `--no-skills` would disable the lot. */
  it('loads each skill directory and stops disabling skills', () => {
    const argv = adapterFor('pi').invocation(ctx('pi', true)).argv;
    expect(argv).not.toContain('--no-skills');
    for (const dir of kit.skillDirs) {
      expect(argv[argv.indexOf(dir) - 1]).toBe('--skill');
    }
    expect(adapterFor('pi').invocation(ctx('pi', false)).argv).toContain('--no-skills');
  });
});

describe('opencode', () => {
  /** OpenCode has no install command: it DISCOVERS skills from the project directory. */
  it('copies the skills into the working directory it is pointed at', async () => {
    const c = ctx('opencode', true);
    fs.mkdirSync(c.cwd, { recursive: true });
    await adapterFor('opencode').prepare(c);
    expect(fs.existsSync(path.join(c.cwd, '.opencode', 'skills', 'artifact-bin', 'SKILL.md'))).toBe(true);
  });
});

describe('codex', () => {
  /**
   * Verified by running both: `plugin marketplace add <pluginDir>` is refused
   * ("marketplace root does not contain a supported manifest"), and `plugin
   * add artifact-bin` without the marketplace suffix is refused too ("requires
   * --marketplace") even with exactly one configured.
   */
  it('adds the MARKETPLACE, then installs the plugin naming it', () => {
    const [market, add] = pluginInstallCommands(kit);
    expect(market).toEqual(['codex', 'plugin', 'marketplace', 'add', kit.marketplaceDir]);
    expect(add[3]).toBe(`${kit.plugin}@${kit.marketplace}`);
    expect(market[4]).not.toBe(kit.pluginDir);
  });
});

describe('the transport a materialization teaches', () => {
  /**
   * `installed_skill+api_action` has no MCP server, so its skills teach curl;
   * `installed_skill+mcp_action` connects the server, so its skills teach
   * the tool calls — the shipped rendering. A tool-teaching skill in a mode
   * with no tools names calls the agent cannot make.
   */
  it('installed API gets curl-teaching skills; installed MCP gets the tool-first rendering', () => {
    const curlDir = path.join(root, 'kit-curl');
    const curl = materializePlugin(curlDir, 'http://127.0.0.1:4242', 'curl');
    const curlBrief = fs.readFileSync(path.join(curl.pluginDir, 'skills/artifact-bin/SKILL.md'), 'utf8');
    expect(curlBrief).toContain('curl -X POST');
    expect(curlBrief).not.toContain('create_artifact({');

    const mcpDir = path.join(root, 'kit-mcp');
    const mcp = materializePlugin(mcpDir, 'http://127.0.0.1:4242', 'mcp');
    const mcpBrief = fs.readFileSync(path.join(mcp.pluginDir, 'skills/artifact-bin/SKILL.md'), 'utf8');
    expect(mcpBrief).toContain('create_artifact({');
    expect(mcpBrief).not.toContain('curl -X POST');
    // The credential-less server config is stripped in BOTH: the MCP action mode wires
    // the server through the harness config carrying the task's token.
    expect(fs.existsSync(path.join(curl.pluginDir, '.mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(mcp.pluginDir, '.mcp.json'))).toBe(false);
  });
});

describe('copySkillsInto', () => {
  it('lands every skill under the discovery directory', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cwd-'));
    const dest = copySkillsInto(kit, cwd);
    expect(fs.readdirSync(dest).sort()).toEqual(['artifact-bin']);
  });
});

describe('what an installed vocabulary does to the score', () => {
  /**
   * Three of the four comparison tasks GRADE `read_docs_before_write`. In
   * installed_skill mode there is no docs fetch to observe — the protocol arrived
   * installed — so gating on it would fail the run for using the mode. Same
   * rule as the unobserved-ledger case: null, never false, and it stops
   * deciding.
   */
  it('stops read_docs_before_write from gating, and leaves the rest alone', () => {
    const listed = ['published', 'read_docs_before_write', 'has_title'];
    expect(gatedChecks(listed, { trafficObserved: true })).toEqual(listed);
    expect(gatedChecks(listed, { trafficObserved: true, vocabularyInstalled: true }))
      .toEqual(['published', 'has_title']);
  });

  it('still drops the ledger-only checks when nothing was observed', () => {
    expect(gatedChecks(['published', 'canonical_stable'], { trafficObserved: false, vocabularyInstalled: true }))
      .toEqual(['published']);
  });
});

describe('the prompt a mode gives', () => {
  const task = { id: 't', brief: 'Do it.', checks: [], handoff: 'token' } as never;
  const access = { kind: 'token', base: 'https://ex.test', token: 'mx_t', id: 'abc123' } as const;

  /**
   * MEASURED, and it cost a whole matrix: installed_skill mode installed the skills and
   * then handed the agent a prompt ending "Read https://…/docs/llm first; it
   * documents every endpoint." Claude Code did exactly that — five fetches of a
   * 29 KB page it already had installed — and the mode came out 3.4× the cost
   * of the paste flow it was meant to beat. The instruction is right for
   * fetched_skill and wrong for every mode that installs the vocabulary.
   */
  it('never sends an agent to fetch docs it was just given', () => {
    const installed = buildPrompt(task, access, { mode: 'installed_skill+api_action' });
    expect(installed).not.toContain('/docs/');
    expect(installed).toMatch(/skills?/i);
    expect(installed).toContain('mx_t');
  });

  /**
   * The opposite error, and I made it in the same sentence: "they carry the
   * whole protocol, so use them rather than fetching documentation" was false
   * once the skills were trimmed to a briefing, and it FORBADE the escape
   * hatch the briefing itself points at. Measured: the `edit` task failed
   * `used_edits_endpoint` for all three agents that ran with installed skills and
   * passed for all four with fetched skills, where nothing told them not to look.
   *
   * Start with the skills, yes. Never fetch, no.
   */
  it('does not forbid the fetch the skills themselves point at', () => {
    const installed = buildPrompt(task, access, { mode: 'installed_skill+api_action' });
    expect(installed).not.toMatch(/rather than fetching|do not fetch|no need to fetch/i);
    expect(installed).not.toMatch(/whole protocol|everything you need/i);
  });

  it('still sends a fetched_skill agent to the docs — that is its handoff', () => {
    expect(buildPrompt(task, access, { mode: 'fetched_skill+api_action' })).toContain('/docs/artifact-bin/SKILL.md');
  });

  it('tells an mcp agent to use the tools, and keeps the token out of the prompt', () => {
    const p = buildPrompt(task, access, { mode: 'fetched_skill+mcp_action' });
    expect(p).toContain('/docs/artifact-bin/SKILL.md?transport=mcp');
    expect(p).not.toContain('mx_t');
    expect(p).toMatch(/tools/i);
  });
});

describe('what installed_skill mode installs', () => {
  /**
   * The plugin ships a `.mcp.json` with no credentials, and installed_skill mode drops
   * `--bare`, which is what turns MCP discovery ON — so Claude Code loaded the
   * server and reported `"status":"needs-auth"`, one 401 in every task of the
   * matrix. The action axis separately tests API calls and MCP tools; an
   * unauthenticated server in between is neither.
   */
  it('leaves no uncredentialed MCP server behind for the harness to find', () => {
    expect(fs.existsSync(path.join(kit.pluginDir, '.mcp.json'))).toBe(false);
  });
});

describe('a substituted transport does not gate on the thing it could not do', () => {
  it('drops used_mcp, and only that', () => {
    const listed = ['published', 'used_mcp', 'has_title'];
    expect(gatedChecks(listed, { trafficObserved: true })).toEqual(listed);
    expect(gatedChecks(listed, { trafficObserved: true, transportSubstituted: true }))
      .toEqual(['published', 'has_title']);
  });
});
