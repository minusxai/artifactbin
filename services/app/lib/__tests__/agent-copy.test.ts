/**
 * THE COPY-TO-AGENT TEXT, ONE SOURCE. The product is fully behind the afbin CLI: no credential is ever
 * handed to an agent, so there is exactly ONE starter for a handed-over document (`existingPaste`, used
 * by both /api/start and the agent-prompt route) — and no second wording beside it.
 */
import { describe, expect, it } from 'vitest';
import * as agentCopy from '@/lib/serving/agent-copy';
import { existingPaste } from '@/lib/serving';
import { DEFAULT_SERVER } from '@artifactbin/contracts';

const B = 'https://x.test';
const ID = 'ab3cd9';
const STARTER = "Edit my artifact at https://x.test/a/ab3cd9 in place. If afbin is not installed, prepare Node (https://x.test/chat/ensure-node.sh; Windows: https://x.test/chat/ensure-node.ps1), then run npx --yes @afbin/cli@latest setup once (Windows: npx.cmd); it installs afbin and its skills. Run afbin help first, then afbin auth https://x.test/a/ab3cd9 --server https://x.test. Approve in the browser that created this artifact; guest access is fine. Pass --server https://x.test to every afbin server command.\n\n---\n\nLet's build an artifact for ";

describe('the tokenless paste', () => {
  it('existing: the link plus how to reach afbin, and never a token', () => {
    expect(existingPaste(B, ID)).toBe(STARTER);
    expect(existingPaste(B, ID)).not.toContain('mx_');
    // `/tokens/new` and any mention of a token at all are banned on this very surface
    // by agent-starter-consistency.test.ts's case (c), over all of them.
  });
  it('carries the installer, so an agent that lacks afbin can get it', () => {
    expect(existingPaste(B, ID)).toContain('npx --yes @afbin/cli@latest setup once (Windows: npx.cmd)');
    expect(existingPaste(B, ID)).toContain('Run afbin help first');
    expect(existingPaste(B, ID).split('@afbin/cli@').length - 1).toBe(1);
    expect(existingPaste(B, ID)).toContain('https://x.test/chat/ensure-node.sh');
  });
  it.each(['https://x.test', 'http://127.0.0.1:45407/'])('selects the handed-over server for every remote command: %s', (base) => {
    expect(existingPaste(base, ID)).toContain(`Pass --server ${base.replace(/\/$/, '')} to every afbin server command`);
  });
  it.each([DEFAULT_SERVER, `${DEFAULT_SERVER}/`])('keeps the handoff short on the host a fresh CLI already defaults to: %s', (base) => {
    expect(existingPaste(base, ID)).not.toContain('--server');
    expect(existingPaste(base, ID)).toContain(`then afbin auth ${DEFAULT_SERVER}/a/${ID}.`);
  });
  it('keeps the handoff concise and leaves a separated brief for the user', () => {
    const prompt = existingPaste('http://127.0.0.1:45407', ID);
    expect(prompt.length).toBeLessThan(650);
    expect(prompt).toContain("\n\n---\n\nLet's build an artifact for " );
  });
  it('a trailing slash on the base does not double up', () => {
    expect(existingPaste('https://x.test/', ID)).toBe(STARTER);
  });
  it('names the selected page type when provided', () => {
    expect(existingPaste(B, ID, 'doc')).toContain('template: doc');
    expect(existingPaste(B, ID, 'deck')).toContain('template: deck');
    expect(existingPaste(B, ID, 'deck')).toContain('/a/ab3cd9');
  });
  it('is the module\'s only export — the start-link paste and the claim relay are gone', () => {
    expect(Object.keys(agentCopy)).toEqual(['existingPaste']);
  });
});
