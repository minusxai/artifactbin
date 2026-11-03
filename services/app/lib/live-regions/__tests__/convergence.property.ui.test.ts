/**
 * Property test, short run (the ui project, so every affected `npm test` and full CI): random interleavings of every
 * edit kind across 2–5 editors with random delivery, duplication and partitions converge to one valid page (I1–I6)
 * and lose no text but the pinned limitation (property.ts). The long run is convergence.soak.test.ts, full CI only.
 */
import { it } from 'vitest';
import { checkConvergence } from './property';

it('converges and keeps text under 150 random interleavings of up to 30 operations', () => {
  checkConvergence(150, 30);
});
