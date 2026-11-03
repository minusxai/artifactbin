import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {TOKEN_RE,hashToken} from '@artifactbin/utils';

/** The presented-token shape and its stored hash; the read itself is auth's `createBearerReader`. */
describe('bearer token shape and hash', () => {
  it('admits only the minted shape', () => {
    expect(TOKEN_RE.test('mx_' + 'a'.repeat(43))).toBe(true);
    for (const value of ['not a token', 'mx_short', 'mx_' + 'a'.repeat(51), 'mx_' + 'a'.repeat(40) + ' ', 'mxr_' + 'a'.repeat(43)]) expect(TOKEN_RE.test(value), value).toBe(false);
  });
  it('stores the hex SHA-256 of the presented value, never the value', () => {
    const presented = 'mx_' + 'b'.repeat(43);
    expect(hashToken(presented)).toBe(createHash('sha256').update(presented).digest('hex'));
    expect(hashToken(presented)).not.toContain(presented);
  });
});
