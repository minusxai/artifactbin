// @vitest-environment jsdom
/**
 * Property test, long run: thousands of random interleavings (property.ts). Heavy, so it runs only in full CI's
 * `integration` project (vitest.config.ts PROPERTY_SOAK_TESTS), never in `npm test` or pr fast.
 */
import { afterAll, beforeAll, it } from 'vitest';
import { installEditorGeometry } from '../../../test/setup/editor-geometry';
import { checkConvergence } from './property';

let restore: () => void;
beforeAll(() => { restore = installEditorGeometry(); });
afterAll(() => restore());

it('converges and keeps text under 4,000 random interleavings of up to 60 operations', () => {
  const { typed, lostToLimitation } = checkConvergence(4_000, 60);
  process.stdout.write(`live-regions soak: 4000 runs, ${typed} characters typed, ${lostToLimitation} lost to a concurrently removed or replaced block\n`);
}, 300_000);
