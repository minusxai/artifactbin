/**
 * `isOwner` / `actorForArtifacts` — the ownership decision, as pure functions.
 *
 * `isOwner` is consulted by BOTH halves of the reader/owner split (proxy.ts
 * chooses the shell or the document; ArtifactDocument decides the chrome), so
 * a disagreement between them is impossible only because they call this. It
 * had been exercised through those callers alone; its edges belong here.
 *
 * The rule it encodes: an ACCOUNT owns by `user_id`, a browser holding only a
 * token owns by `token_id`. The dangerous shapes are the mixed ones — an
 * anonymous document (no user_id) seen by an account, and an account-owned
 * document seen by a browser holding some other token.
 */
import { describe, expect, it } from 'vitest';
import { actorForArtifacts, isOwner } from '@/lib/viewer';
import type { RequestActor } from '@/lib/viewer';

const account = (userId: string, tokenId: string | null = null): RequestActor =>
  ({ viewer: { userId, email: null }, tokenId, credential: 'session' });
const browser = (tokenId: string): RequestActor => ({ viewer: null, tokenId, credential: 'agent-cookie' });
const nobody: RequestActor = { viewer: null, tokenId: null, credential: 'none' };

const row = (user_id: string | null, token_id: string) => ({ user_id, token_id });

describe('isOwner', () => {
  it('an account owns what its user_id owns', () => {
    expect(isOwner(row('usr_a', 'tok_1'), account('usr_a'))).toBe(true);
    expect(isOwner(row('usr_b', 'tok_1'), account('usr_a'))).toBe(false);
  });

  it('a browser holding a token owns what that token created', () => {
    expect(isOwner(row(null, 'tok_1'), browser('tok_1'))).toBe(true);
    expect(isOwner(row(null, 'tok_2'), browser('tok_1'))).toBe(false);
  });

  it('an ANONYMOUS document is nobody\'s by account — no user_id to match', () => {
    // The dangerous shape: a signed-in stranger must not inherit an unowned doc.
    expect(isOwner(row(null, 'tok_1'), account('usr_a'))).toBe(false);
    // …but the account's own token still recognises it, which is what claiming
    // is for and how an anonymous doc reaches its owner before claiming.
    expect(isOwner(row(null, 'tok_1'), account('usr_a', 'tok_1'))).toBe(true);
  });

  it('an account-owned document is not owned by a browser holding another token', () => {
    expect(isOwner(row('usr_a', 'tok_1'), browser('tok_2'))).toBe(false);
    // …and IS owned by a browser holding the very token that created it —
    // the claimed-token-without-session case (the split-viewer bug).
    expect(isOwner(row('usr_a', 'tok_1'), browser('tok_1'))).toBe(true);
  });

  it('no credential owns nothing', () => {
    expect(isOwner(row('usr_a', 'tok_1'), nobody)).toBe(false);
    expect(isOwner(row(null, 'tok_1'), nobody)).toBe(false);
  });
});

describe('actorForArtifacts', () => {
  it('an account scopes by user, whether or not a token rides along', () => {
    expect(actorForArtifacts(account('usr_a'))).toEqual({ tokenId: '', userId: 'usr_a' });
    expect(actorForArtifacts(account('usr_a', 'tok_1'))).toEqual({ tokenId: 'tok_1', userId: 'usr_a' });
  });

  it('a browser scopes by its token alone', () => {
    expect(actorForArtifacts(browser('tok_1'))).toEqual({ tokenId: 'tok_1', userId: null });
  });

  it('no credential is no scope — never an empty one that would match rows', () => {
    // Returning `{tokenId:'', userId:null}` here would scope a query to
    // `token_id = ''`, which is a query, not a refusal. Null forces the caller
    // to answer 401.
    expect(actorForArtifacts(nobody)).toBeNull();
  });
});
