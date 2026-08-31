/**
 * `withoutToken` — the inverse of `withToken`, in BOTH agent-session modules (tok-p1, reject).
 *
 * The list is ordered and the LAST entry is the primary (see agent-session-shape.test.ts). Dropping one id
 * must keep the order of the rest, so the browser's primary changes only when the primary itself is dropped.
 * Nothing left ⇒ null, which the route turns into a cleared cookie.
 *
 * Also pinned here, a drift measured in the de-risk pass: utils caps the held list at 8 ids and the APP
 * (the cookie WRITER) did not — so the cap never applied. Both writers must agree.
 */
import { describe, expect, it } from 'vitest';
import { withToken as appWith, withoutToken as appWithout } from '@/lib/agent-session';
import { withToken as utilsWith, withoutToken as utilsWithout } from '../../../utils/src/agent-session';

for (const [name, withToken, withoutToken] of [
  ['app', appWith, appWithout],
  ['utils', utilsWith, utilsWithout],
] as const) {
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
