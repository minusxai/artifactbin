// @vitest-environment jsdom
/**
 * Property test, short run: pr fast, every affected `npm test` and full CI, sized to stay well inside the fast lane's
 * 2 s per test on a CI runner (150 cases timed out there). Random interleavings of every edit kind across 2–5 editors
 * with random delivery, duplication and partitions converge to one valid page (I1–I6) and lose no text that nobody
 * deleted (I4, strict). The long run is convergence.soak.test.ts, full CI only.
 */
import { it } from 'vitest';
import { checkConvergence, runScenario } from './property';

it('converges and keeps text under 15 random interleavings of up to 30 operations', () => {
  checkConvergence(15, 30);
});

// Shrunk counterexamples from the soak, replayed exactly on every run.
it('soak seed 660187254: one editor splits the start of the quote, then the end of the list item before it', () => {
  runScenario({ clients: 2, region: 0, ops: [{ op: 'split', client: 1, at: 5963 }, { op: 'split', client: 1, at: 9998 }] });
});
it('soak seed -832068225: one editor makes both paragraphs code blocks, a peer presses Enter at the start of the second, then joins it to the first', () => {
  runScenario({ clients: 2, region: 1, ops: [{ op: 'shortcut', client: 0, at: 0, which: '```' }, { op: 'shortcut', client: 0, at: 2403, which: '```' }, { op: 'sync' }, { op: 'split', client: 1, at: 3757 }, { op: 'join', client: 1, at: 0 }] });
});
