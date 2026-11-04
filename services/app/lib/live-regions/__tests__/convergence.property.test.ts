// @vitest-environment jsdom
/**
 * Property test, short run: pr fast, every affected `npm test` and full CI, sized to stay well inside the fast lane's
 * 2 s per test on a CI runner (150 cases timed out there). Random interleavings of every edit kind across 2–5 editors
 * with random delivery, duplication and partitions converge to one valid page (I1–I6) and lose no text that nobody
 * deleted (I4, strict). The long run is convergence.soak.test.ts, full CI only.
 */
import { it } from 'vitest';
import { checkConvergence } from './property';

it('converges and keeps text under 15 random interleavings of up to 30 operations', () => {
  checkConvergence(15, 30);
});
