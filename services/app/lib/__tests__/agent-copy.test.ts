/**
 * THE COPY-TO-AGENT TEXT, ONE SOURCE. The product is fully behind the afbin CLI: no credential is ever
 * handed to an agent, so there is exactly ONE starter for a handed-over document (`existingPaste`, used
 * by both /api/start and the agent-prompt route) — and no second wording beside it.
 */
import { describe, expect, it } from 'vitest';
import * as agentCopy from '@/lib/agent-copy';
import { existingPaste } from '@/lib/agent-copy';

const B = 'https://x.test';
const ID = 'ab3cd9';
const STARTER =
  'Help me edit my artifact at https://x.test/a/ab3cd9. Use the afbin CLI to operate artifactbin, or (curl -fsSL https://x.test/chat/install.sh | sh) if not installed. Run afbin help first. Pass --server https://x.test to every afbin server command.';

describe('the tokenless paste', () => {
  it('existing: the link plus how to reach afbin, and never a token', () => {
    expect(existingPaste(B, ID)).toBe(STARTER);
    expect(existingPaste(B, ID)).not.toContain('mx_');
    // `/tokens/new` and any mention of a token at all are banned on this very surface
    // by agent-starter-consistency.test.ts's case (c), over all nine of them.
  });
  it('carries the installer, so an agent that lacks afbin can get it', () => {
    expect(existingPaste(B, ID)).toContain('curl -fsSL https://x.test/chat/install.sh | sh');
  });
  it.each(['https://x.test', 'http://127.0.0.1:45407/'])('selects the handed-over server for every remote command: %s', (base) => {
    expect(existingPaste(base, ID)).toContain(`Pass --server ${base.replace(/\/$/, '')} to every afbin server command`);
  });
  it.each(['https://artifactbin.dev', 'https://artifactbin.dev/'])('keeps the default production handoff short: %s', (base) => {
    expect(existingPaste(base, ID)).not.toContain('--server');
    expect(existingPaste(base, ID)).toContain('Run afbin help first.');
  });
  it('keeps the local handoff within the browser flow’s single-line copy budget', () => {
    const prompt = existingPaste('http://127.0.0.1:45407', ID);
    expect(prompt.length).toBeLessThan(300);
    expect(prompt).not.toContain('\n');
  });
  it('a trailing slash on the base does not double up', () => {
    expect(existingPaste('https://x.test/', ID)).toBe(STARTER);
  });
  it('is the module\'s only export — the start-link paste and the claim relay are gone', () => {
    expect(Object.keys(agentCopy)).toEqual(['existingPaste']);
  });
});
