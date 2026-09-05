/** The split's env names are RETIRED: named with their fate, and read by nobody. */
import { describe, expect, it } from 'vitest';
import { RETIRED_ENV_NAMES, envNamesRead } from '@/lib/config';

/**
 * The per-limit `RATE_LIMITER__*` names are NOT here any more, deliberately: with the door vocabulary gone
 * there is no prefix exemption left, so a leftover one is reported by the ordinary unknown-name audit
 * ("is set but nothing reads it") rather than by this map. Naming them here would also forbid the proxy's
 * own suite from handing one to `loadConfig` as the fixture that proves exactly that.
 */
const GONE = ['EVENTS__DATABASE_URL', 'APP__INTERNAL_ORIGIN', 'CONTRACT__ACTOR_SECRET'];
describe('retired env names', () => {
  it('are named in RETIRED_ENV_NAMES and are no longer read by config', () => {
    for (const name of GONE) {
      expect(Object.keys(RETIRED_ENV_NAMES), name).toContain(name);
      expect([...envNamesRead()], name).not.toContain(name);
    }
  });
});
