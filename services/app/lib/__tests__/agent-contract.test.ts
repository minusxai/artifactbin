/**
 * WHAT WE TELL THE LLM — ONE canonical "agent contract", the SAME words everywhere (tok-p3, plan §4b).
 *
 * lib/agent-contract exports `agentContract(base)`: a markdown block that names where the token lives
 * (~/.artifactbin.env), how to get one (a start link, or send the human to /tokens/new), that tokens expire
 * (6 h default; expiresInHours 1–720 at mint), what to do on 401/expired (/tokens/new, save, resume — never a
 * blind retry), and header-only auth. It is rendered VERBATIM into: the skill reference publishing-auth.md
 * (= llms.txt's auth section; the file uses the `[[ base ]]` placeholder), the MCP initialize instructions, and
 * the start-link brief.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { describe, expect, it } from 'vitest';
import { agentContract } from '@/lib/agent-contract';
import { buildMcpInstructions, renderDoc } from '@/lib/skills';
import { startBrief } from '@/lib/start-links';

const B = 'https://x.test';
const contract = () => agentContract(B);
const publishingAuth = () => renderDoc('artifact-bin/references/publishing-auth.md', B);

describe('the contract itself', () => {
  it('names the token file, and says to check it first', () => {
    expect(contract()).toContain('~/.artifactbin.env');
    expect(contract()).toContain('ARTIFACTBIN_TOKEN=');
    expect(contract()).toMatch(/check it first/i);
    expect(contract()).toContain('~/.config/artifact-bin/config.json');
  });
  it('names both ways to get a token, on this base', () => {
    expect(contract()).toContain(`${B}/tokens/new`);
    expect(contract()).toMatch(/start link/i);
  });
  it('recognizes an inline token in the human paste', () => {
    expect(contract()).toContain("If your user's paste says `using this token: mx_…`, that IS your token: save it to `~/.artifactbin.env` and use it.");
  });
  it('says tokens expire, with the default and the knob', () => {
    expect(contract()).toMatch(/6 ?h/i);
    expect(contract()).toContain('expiresInHours');
    expect(contract()).toContain('expiresAt');
  });
  it('on 401 or expiry: /tokens/new, save, resume — never a blind retry', () => {
    expect(contract()).toMatch(/401/);
    expect(contract()).toMatch(/do not retry|never retry/i);
  });
  it('header auth only; the token never rides a URL', () => {
    expect(contract()).toContain('Authorization: Bearer');
    expect(contract()).not.toMatch(/[?&]token=/);
  });
  it('is deterministic for a base', () => {
    expect(agentContract(B)).toBe(agentContract(B));
    expect(agentContract('https://y.test')).not.toBe(agentContract(B));
  });
});

describe('the same words, everywhere', () => {
  it('publishing-auth.md carries the contract with the [[ base ]] placeholder', () => {
    expect(publishingAuth()).toContain(contract());
    expect(publishingAuth()).not.toContain('[[');
  });
  it('the MCP initialize instructions carry it', () => {
    expect(buildMcpInstructions(B)).toContain(contract());
  });
  it('the start-link brief carries it', () => {
    expect(startBrief(B, 'ab3cd9', 'k123')).toContain(contract());
  });
});
