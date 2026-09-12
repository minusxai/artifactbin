/**
 * THE COPY-TO-AGENT TEXTS, ONE SOURCE. The product is fully behind the afbin CLI: no token is ever
 * handed to an agent, so there is ONE tokenless starter for a handed-over document (`existingPaste`,
 * used by both /api/start and the agent-prompt route) plus the unchanged start-link paste.
 *
 *   existingPaste   a document handed over — the link plus how to reach afbin, no token
 *   startLinkPaste  the start-link flow, unchanged wording; lib/start-links `startPrompt` IS this function
 */
import { describe, expect, it } from 'vitest';
import { existingPaste, startLinkPaste } from '@/lib/agent-copy';
import { startPrompt } from '@/lib/start-links';

const B = 'https://x.test';
const ID = 'ab3cd9';
const STARTER =
  'Help me edit my artifact at https://x.test/a/ab3cd9. Use the afbin CLI to operate artifactbin, or (curl -fsSL https://x.test/chat/install.sh | sh) if not installed. Run afbin help first.';

describe('the tokenless pastes', () => {
  it('existing: the link plus how to reach afbin, and never a token', () => {
    expect(existingPaste(B, ID)).toBe(STARTER);
    expect(existingPaste(B, ID)).not.toContain('mx_');
    expect(existingPaste(B, ID)).not.toContain('/tokens/new');
    expect(existingPaste(B, ID)).not.toMatch(/token/i);
  });
  it('start link: today\'s wording, and startPrompt is the same function', () => {
    expect(startLinkPaste(B, ID, 'k123')).toBe('Help me edit my artifact. Follow instructions at https://x.test/a/ab3cd9/start?k=k123');
    expect(startPrompt).toBe(startLinkPaste);
  });
  it('a trailing slash on the base does not double up', () => {
    expect(existingPaste('https://x.test/', ID)).toBe(STARTER);
  });
});
