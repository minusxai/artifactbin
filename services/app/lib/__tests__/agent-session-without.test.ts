/**
 * `withoutToken` — the inverse of `withToken` (tok-p1, reject).
 *
 * The list is ordered and the LAST entry is the primary (see agent-session-shape.test.ts). Dropping one id
 * must keep the order of the rest, so the browser's primary changes only when the primary itself is dropped.
 * Nothing left ⇒ null, which the route turns into a cleared cookie.
 *
 * There used to be TWO of these — the app reimplemented what utils already had, and a drift measured in the
 * de-risk pass showed it: utils capped the held list at 8 ids and the APP (the cookie WRITER) did not, so
 * the cap never applied. There is one implementation now, and the first case below is what keeps it that
 * way: the app module must re-export the shared one rather than grow its own again.
 */
import { describe, expect, it } from 'vitest';
import { withToken, withoutToken } from '@/lib/agent-session';
import { withToken as utilsWith, withoutToken as utilsWithout } from '../../../utils/src/agent-session';

describe('the app module', () => {
  it('re-exports the shared list operations rather than holding its own', () => {
    expect(withToken).toBe(utilsWith);
    expect(withoutToken).toBe(utilsWithout);
  });
});

{
  const name = 'shared';
  describe(`withoutToken (${name})`, () => {
    it('drops one id and keeps the order of the rest', () => {
      expect(withoutToken({ tokenIds: ['a', 'b', 'c'] }, 'b')).toEqual({ tokenIds: ['a', 'c'] });
    });
    it('dropping the primary promotes the previous one', () => {
      expect(withoutToken({ tokenIds: ['a', 'b', 'c'] }, 'c')).toEqual({ tokenIds: ['a', 'b'] });
    });
    it('an id that is not held changes nothing', () => {
      expect(withoutToken({ tokenIds: ['a', 'b'] }, 'zzz')).toEqual({ tokenIds: ['a', 'b'] });
    });
    it('the last id leaves nothing — null, for a cleared cookie', () => {
      expect(withoutToken({ tokenIds: ['a'] }, 'a')).toBeNull();
      expect(withoutToken(null, 'a')).toBeNull();
      expect(withoutToken({ tokenIds: [] }, 'a')).toBeNull();
    });
    it('does not mutate its input', () => {
      const held = { tokenIds: ['a', 'b'] };
      withoutToken(held, 'a');
      expect(held).toEqual({ tokenIds: ['a', 'b'] });
    });
  });

  /*
   * The ordering contract, from agent-session-shape.test.ts, which pinned it for the
   * app module alone: the list is not a set. The LAST entry is the primary — the one a
   * write acts as — so re-presenting a held token PROMOTES it rather than being ignored.
   * A set-like implementation passes a happy-path route test while silently changing
   * which token writes.
   */
  describe(`withToken order (${name})`, () => {
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

  describe(`withToken cap (${name})`, () => {
    it('holds at most 8 ids, the newest last', () => {
      let held: { tokenIds: string[] } | null = null;
      for (let i = 1; i <= 10; i += 1) held = withToken(held, `tok_${i}`);
      expect(held!.tokenIds).toHaveLength(8);
      expect(held!.tokenIds.at(-1)).toBe('tok_10');
      expect(held!.tokenIds[0]).toBe('tok_3');
    });
  });
}
