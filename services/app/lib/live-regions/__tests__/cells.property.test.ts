/**
 * Property test, short run (pr fast and every affected `npm test`): a live dataset text cell under random typing,
 * deletion, delivery and dataset writes converges and loses no character nobody deleted (cells-property.ts). The
 * long run is cells.soak.test.ts, full CI only.
 */
import { it } from 'vitest';
import { checkCellConvergence } from './cells-property';

it('converges and keeps every typed character under 40 random interleavings of up to 40 operations', () => {
  checkCellConvergence(40, 40);
});
