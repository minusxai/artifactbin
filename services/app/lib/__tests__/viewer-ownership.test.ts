/**
 * `ownsArtifact` — the ownership decision, as a pure function over a request's resolved identity.
 *
 * It is consulted by BOTH halves of the reader/owner split (the page chooses the shell or the document; the
 * document decides the chrome), so a disagreement between them is impossible only because they call this.
 *
 * The rule it encodes: an ACCOUNT owns by `user_id`, a browser holding only a token owns by `token_id`. The
 * dangerous shapes are the mixed ones — an anonymous document (no user_id) seen by an account, and an
 * account-owned document seen by a browser holding some other token.
 */
import { describe, expect, it } from 'vitest';
import { NO_IDENTITY } from '@/lib/accounts';
import { ownsArtifact } from '@/lib/artifact-access';
import { testIdentity } from '@/__tests__/harness';

const account = (userId: string, tokenId: string | null = null) => testIdentity('session', { userId, tokenId });
const browser = (tokenId: string) => testIdentity('agent-cookie', { tokenId });
const nobody = NO_IDENTITY;

const row = (user_id: string | null, token_id: string) => ({ user_id, token_id });

describe('ownsArtifact', () => {
  it('an account owns what its user_id owns', () => {
    expect(ownsArtifact(row('usr_a', 'tok_1'), account('usr_a'))).toBe(true);
    expect(ownsArtifact(row('usr_b', 'tok_1'), account('usr_a'))).toBe(false);
  });

  it('a browser holding a token owns what that token created', () => {
    expect(ownsArtifact(row(null, 'tok_1'), browser('tok_1'))).toBe(true);
    expect(ownsArtifact(row(null, 'tok_2'), browser('tok_1'))).toBe(false);
  });

  it('an ANONYMOUS document is nobody\'s by account — no user_id to match', () => {
    // The dangerous shape: a signed-in stranger must not inherit an unowned doc.
    expect(ownsArtifact(row(null, 'tok_1'), account('usr_a'))).toBe(false);
    // …but the account's own token still recognises it, which is what claiming
    // is for and how an anonymous doc reaches its owner before claiming.
    expect(ownsArtifact(row(null, 'tok_1'), account('usr_a', 'tok_1'))).toBe(true);
  });

  it('an account-owned document is not owned by a browser holding another token', () => {
    expect(ownsArtifact(row('usr_a', 'tok_1'), browser('tok_2'))).toBe(false);
    // A creating token is provenance once an account owns the row.
    // Credential resolution must supply the token account before this decision.
    expect(ownsArtifact(row('usr_a', 'tok_1'), browser('tok_1'))).toBe(false);
  });

  it('no credential owns nothing', () => {
    expect(ownsArtifact(row('usr_a', 'tok_1'), nobody)).toBe(false);
    expect(ownsArtifact(row(null, 'tok_1'), nobody)).toBe(false);
  });
});
