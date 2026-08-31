/**
 * `withToken` — the order of what a browser holds (lib/agent-session).
 *
 * The list is not a set: the LAST entry is the primary, the one a write acts
 * as. That is the rule every call site was built on ("the token you touched
 * last authorizes your next request"), and it is why re-presenting a held
 * token PROMOTES it rather than being ignored — a browser unlocking a second
 * document, then returning to the first, must act as the first again.
 *
 * Exercised through the exchange route already; pinned here because the
 * ordering is the whole contract and a set-like implementation would pass a
 * happy-path route test while silently changing which token writes.
 */
import { describe, expect, it } from 'vitest';
import { withToken } from '@/lib/agent-session';

describe('withToken', () => {
  it('adds to an empty browser', () => {
    expect(withToken(null, 'tok_1')).toEqual({ tokenIds: ['tok_1'] });
    expect(withToken({ tokenIds: [] }, 'tok_1')).toEqual({ tokenIds: ['tok_1'] });
  });

  it('appends newest LAST — the newest is the one that writes', () => {
    expect(withToken({ tokenIds: ['tok_1'] }, 'tok_2')).toEqual({ tokenIds: ['tok_1', 'tok_2'] });
  });

  it('PROMOTES a token it already holds instead of duplicating it', () => {
    expect(withToken({ tokenIds: ['tok_1', 'tok_2'] }, 'tok_1')).toEqual({ tokenIds: ['tok_2', 'tok_1'] });
    // Re-presenting the primary is a no-op in effect, never a duplicate.
    expect(withToken({ tokenIds: ['tok_1', 'tok_2'] }, 'tok_2')).toEqual({ tokenIds: ['tok_1', 'tok_2'] });
  });

  it('never mutates the session it was given', () => {
    const held = { tokenIds: ['tok_1', 'tok_2'] };
    withToken(held, 'tok_1');
    expect(held.tokenIds).toEqual(['tok_1', 'tok_2']);
  });
});
