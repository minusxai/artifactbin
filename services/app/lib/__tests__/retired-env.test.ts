/** The split's env names are RETIRED: named with their fate, and read by nobody. */
import { describe, expect, it } from 'vitest';
import { RETIRED_ENV_NAMES, envNamesRead } from '@/lib/config';

const GONE = ['EVENTS__DATABASE_URL', 'APP__INTERNAL_ORIGIN', 'RATE_LIMITER__BACKEND', 'RATE_LIMITER__DENYLIST_FILE', 'RATE_LIMITER__ALLOWLIST_FILE', 'CONTRACT__ACTOR_SECRET'];
describe('retired env names', () => {
  it('are named in RETIRED_ENV_NAMES and are no longer read by config', () => {
    for (const name of GONE) {
      expect(Object.keys(RETIRED_ENV_NAMES), name).toContain(name);
      expect([...envNamesRead()], name).not.toContain(name);
    }
  });
});
