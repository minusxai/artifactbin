/**
 * The prompt an agent is given: the task's brief plus how it reaches the
 * product. Two handoffs, both of them ones `/docs/llm` teaches — the product paste
 * (the product's own paste flow, where the token goes to the AGENT) and a token
 * handed over directly (needed when the driver must set something up first: a
 * document to edit, an MCP config to write).
 */
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../lib/tasks';
import type { Task } from '../lib/contracts';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'protocol', kind: 'open', brief: 'Publish a one-paragraph document titled "Hello".',
  handoff: 'start-link', order: 0, checks: ['published'], ...over,
});

const START = 'Help me edit my artifact at http://127.0.0.1:3101/a/abc123 using this token: mx_secret';

describe('buildPrompt — product-paste handoff', () => {
  it('is the brief followed by the product\'s own start line, verbatim', () => {
    const prompt = buildPrompt(task(), { kind: 'start-link', startPrompt: START });
    expect(prompt).toBe(`${task().brief}\n\n${START}`);
  });

  it('refuses a paste carrying no token', () => {
    expect(() => buildPrompt(task(), { kind: 'start-link', startPrompt: 'Help me edit my artifact.' })).toThrow(/token/i);
  });
});

describe('buildPrompt — token handoff', () => {
  const access = { kind: 'token' as const, base: 'http://127.0.0.1:3101', token: 'mx_secret', id: 'abc123' };

  it('names the base URL, the token and the document, after the brief', () => {
    const prompt = buildPrompt(task({ handoff: 'token' }), access);
    expect(prompt.startsWith(task().brief)).toBe(true);
    expect(prompt).toContain('http://127.0.0.1:3101');
    expect(prompt).toContain('mx_secret');
    expect(prompt).toContain('abc123');
    expect(prompt).toContain('/docs/artifactbin/SKILL.md');
  });

  it('installed_skill+mcp_action names both halves of the full plugin treatment', () => {
    const prompt = buildPrompt(task({ handoff: 'token' }), access, { mode: 'installed_skill+mcp_action' });
    expect(prompt).toContain('MCP server is already connected');
    expect(prompt).toContain('skill is installed');
    expect(prompt).not.toContain('mx_secret'); // the token rides the MCP config, never the prompt
  });

  it('fetched_skill+mcp_action points at the connected server and the MCP-compiled fetched skill', () => {
    const prompt = buildPrompt(task({ handoff: 'token' }), access, { mode: 'fetched_skill+mcp_action' });
    expect(prompt).toContain('MCP');
    expect(prompt).toContain('/SKILL.md?transport=mcp');
    expect(prompt).not.toContain('mx_secret'); // the token is in the harness config, not the agent's prompt
  });

  it('installed_skill+api_action names the installed skill and passes the API token', () => {
    const prompt = buildPrompt(task({ handoff: 'token' }), access, { mode: 'installed_skill+api_action' });
    expect(prompt).toContain('skill is installed');
    expect(prompt).toContain('mx_secret');
    expect(prompt).not.toContain('/docs/');
  });
});

describe('buildPrompt — a model that cannot see', () => {
  it('says so, once, for a leg without vision', () => {
    const seeing = buildPrompt(task(), { kind: 'start-link', startPrompt: START }, { vision: true });
    const blind = buildPrompt(task(), { kind: 'start-link', startPrompt: START }, { vision: false });
    expect(seeing).not.toMatch(/cannot view images/i);
    // The product invites an agent to fetch its own PNG (`GET /a/<id>/export`); a text-only
    // model 400s on it, and should not spend its run finding that out.
    expect(blind).toMatch(/cannot view images/i);
    expect(blind.startsWith(task().brief)).toBe(true);
  });
});

/**
 * Plugin mode without MCP: a person mints a token at /tokens/new and the skill reads it from ~/.artifactbin.env —
 * the driver writes that file; the prompt never carries the token (decided 2026-09-03). Seeded RED by the orchestrator.
 */
describe('the installed-skill prompt carries no token', () => {
  it('names the saved connection file instead of the secret', () => {
    const prompt = buildPrompt(task(), { kind: 'token', base: 'https://x.test', token: 'mx_SECRET_VALUE', id: 'abc123' }, { mode: 'installed_skill+api_action' });
    expect(prompt).not.toContain('mx_');
    expect(prompt).toContain('~/.artifactbin.env');
  });
  it('the MCP prompts stay token-free too', () => {
    for (const mode of ['fetched_skill+mcp_action', 'installed_skill+mcp_action'] as const) {
      const prompt = buildPrompt(task(), { kind: 'token', base: 'https://x.test', token: 'mx_SECRET_VALUE', id: 'abc123' }, { mode });
      expect(prompt, mode).not.toContain('mx_');
    }
  });
});
