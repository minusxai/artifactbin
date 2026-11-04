/**
 * Property test, long run: a live dataset text cell under thousands of random interleavings (cells-property.ts).
 * Heavy, so it runs only in full CI's `integration` project (vitest.config.ts PROPERTY_SOAK_TESTS).
 */
import { it } from 'vitest';
import { checkCellConvergence } from './cells-property';

it('converges and keeps every typed character under 3,000 random interleavings of up to 80 operations', () => {
  const { typed } = checkCellConvergence(3_000, 80);
  process.stdout.write(`live cells soak: 3000 runs, ${typed} characters typed, 0 lost\n`);
}, 300_000);
