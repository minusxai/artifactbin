/**
 * THE COPY-TO-AGENT TEXTS, ONE SOURCE (tok-p3, plan §3c). Four pastes, character-exact, from lib/agent-copy —
 * every surface (AgentLink, the agent-prompt route, NextSteps, start-links) imports these; no second copy.
 *
 *   anonymousPaste  logged-out home, the document /api/start just minted — the token INLINE (user decision 2026-08-31)
 *   ownedPaste      logged-in, a document the account owns — "using your token", NO link to /tokens/new in the text
 *   existingPaste   an existing document handed over — the agent uses the token it holds
 *   startLinkPaste  the start-link flow, unchanged wording; lib/start-links `startPrompt` IS this function
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { describe, expect, it } from 'vitest';
import { anonymousPaste, existingPaste, ownedPaste, startLinkPaste } from '@/lib/agent-copy';
import { startPrompt } from '@/lib/start-links';

const B = 'https://x.test';
const ID = 'ab3cd9';

describe('the four pastes', () => {
  it('anonymous: link + the token inline', () => {
    expect(anonymousPaste(B, ID, 'mx_secret')).toBe('Help me edit my artifact at https://x.test/a/ab3cd9 using this token: mx_secret');
  });
  it('owned: link + "using your token", and never a /tokens/new link', () => {
    expect(ownedPaste(B, ID)).toBe('Help me edit my artifact at https://x.test/a/ab3cd9 using your token');
    expect(ownedPaste(B, ID)).not.toContain('/tokens/new');
  });
  it('existing: the link alone', () => {
    expect(existingPaste(B, ID)).toBe('Help me edit my artifact at https://x.test/a/ab3cd9');
  });
  it('start link: today\'s wording, and startPrompt is the same function', () => {
    expect(startLinkPaste(B, ID, 'k123')).toBe('Help me edit my artifact. Follow instructions at https://x.test/a/ab3cd9/start?k=k123');
    expect(startPrompt).toBe(startLinkPaste);
  });
  it('a trailing slash on the base does not double up', () => {
    expect(existingPaste('https://x.test/', ID)).toBe('Help me edit my artifact at https://x.test/a/ab3cd9');
  });
});
