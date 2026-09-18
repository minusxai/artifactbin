import { describe, expect, it } from 'vitest';
import { avatarPath, avatarUrl, avatarVersion } from '@/lib/avatars';

describe('avatarUrl (pure)', () => {
  it('is null for a person with no picture', () => {
    expect(avatarUrl({ id: 'usr_abc', image_key: null })).toBeNull();
  });

  it('addresses the serving route by id and carries the content hash as v', () => {
    const key = 'avatar/' + 'a'.repeat(64);
    expect(avatarVersion(key)).toBe('a'.repeat(64));
    expect(avatarUrl({ id: 'usr_abc', image_key: key })).toBe(`${avatarPath('usr_abc')}?v=${'a'.repeat(64)}`);
    expect(avatarPath('usr_abc')).toBe('/api/users/usr_abc/avatar');
  });
});
