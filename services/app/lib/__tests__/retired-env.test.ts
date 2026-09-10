/** Retired app settings remain diagnosable and are not read by app config. */
import { describe, expect, it } from 'vitest';
import { RETIRED_ENV_NAMES, envNamesRead } from '@/lib/config';

/**
 * The per-limit `RATE_LIMITER__*` names are NOT here any more, deliberately: with the door vocabulary gone
 * there is no prefix exemption left, so a leftover one is reported by the ordinary unknown-name audit
 * ("is set but nothing reads it") rather than by this map. Naming them here would also forbid the proxy's
 * own suite from handing one to `loadConfig` as the fixture that proves exactly that.
 */
const GONE = ['EVENTS__DATABASE_URL', 'APP__INTERNAL_ORIGIN', 'CONTRACT__ACTOR_SECRET', 'INVITE__CODE', 'WAITLIST__WEBHOOK_URL'];
describe('retired env names', () => {
  it('are named in RETIRED_ENV_NAMES and are no longer read by config', () => {
    for (const name of GONE) expect(RETIRED_ENV_NAMES).toHaveProperty(name);
    for (const name of Object.keys(RETIRED_ENV_NAMES)) {
      expect(Object.keys(RETIRED_ENV_NAMES), name).toContain(name);
      expect([...envNamesRead()], name).not.toContain(name);
    }
  });
});
