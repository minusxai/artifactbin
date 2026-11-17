/**
 * NO SUB-SECOND WALL-CLOCK BOUNDS IN TESTS. A test that asserts `performance.now() - start` under a few hundred
 * milliseconds measures the runner, not the product: a SQL worker respawned under tsx takes ~130 ms locally and 700-890 ms
 * on a loaded 4-vCPU CI runner, and 650 ms bounds around cancellation and respawn turned main red twice (#1292, the run
 * for #1297). Claim the outcome or the order instead (the answer kind, the worker replaced, the queued read answering while
 * the busy one runs, fake timers), or put an elapsed bound far under the limit a broken path would run to.
 *
 * The scan: in every tracked test file, a `toBeLessThan`/`toBeLessThanOrEqual` under 1000 whose `expect(...)` argument
 * calls `performance.now()`/`Date.now()` or names a value assigned from one (a timestamp or a difference). A line that
 * must keep one says why on the same line: `// wall-clock-ok: <reason>`. Run by pr fast's guard lane
 * (scripts/ci/guard-tests.json); reads the tree, imports nothing of the product.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_FILE = /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?$/;
/** Assembled from parts so this file does not spell what it scans for. */
const CLOCK = ['performance', 'Date'].map((owner) => `${owner}\\.now\\(\\)`).join('|');
const CALLS_CLOCK = new RegExp(`(?:${CLOCK})`);
/** `name = performance.now()…` or `name: Date.now() - …`: a timestamp or a difference taken from the clock. */
const FROM_CLOCK = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*(?::|=(?!=))\\s*(?:${CLOCK})`, 'g');
const BOUND = new RegExp(`\\.${'toBeLessThan'}(?:OrEqual)?\\(\\s*([\\d_]+)\\s*\\)`, 'g');
/** The allowance, with its reason: at least a few words after the marker. */
const ALLOWED = new RegExp(`//\\s*${'wall-clock'}-ok:\\s*\\S.{9,}`);
const SUB_SECOND_MS = 1000;

/** Pure, so a synthetic violation proves it bites. `files` is a list of `[path, text]`; returns `path:line: text`. */
export function subSecondClockBounds(files) {
  const found = [];
  for (const [file, text] of files) {
    if (!CALLS_CLOCK.test(text)) continue;
    const clocked = new Set([...text.matchAll(FROM_CLOCK)].map((match) => match[1]));
    const namesClock = (argument) => CALLS_CLOCK.test(argument) || [...clocked].some((name) => new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$&')}(?![\\w$])`).test(argument));
    text.split('\n').forEach((line, index) => {
      if (ALLOWED.test(line)) return;
      for (const match of line.matchAll(BOUND)) {
        if (Number(match[1].replaceAll('_', '')) >= SUB_SECOND_MS) continue;
        const before = line.slice(0, match.index);
        const opened = before.lastIndexOf('expect(');
        if (opened >= 0 && namesClock(before.slice(opened))) found.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return found;
}

const trackedTests = () => execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => TEST_FILE.test(file) && fs.existsSync(path.join(ROOT, file)))
  .map((file) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]);

describe('sub-second wall-clock bounds', () => {
  const now = (owner) => `${owner}.now()`;
  const bound = (ms) => `.${'toBeLessThan'}(${ms})`;
  const allow = `// ${'wall-clock'}-ok:`;

  it('finds a direct difference, a named difference, two named timestamps and an OrEqual bound', () => {
    const text = [
      `const start = ${now('performance')};`,
      `expect(${now('performance')} - start)${bound(650)};`,
      `const ms = ${now('Date')} - t0;`,
      `expect(ms)${bound('200')};`,
      `const answered = ${now('performance')};`,
      `expect(answered - start, phases)${bound('1_00')};`,
      `expect(${now('Date')} - t0).${'toBeLessThan'}OrEqual(999);`,
      `const r = { answeredAt: ${now('performance')} - sent };`,
      `expect(r.answeredAt)${bound(700)};`,
    ].join('\n');
    expect(subSecondClockBounds([['a.test.ts', text]]).map((hit) => hit.split(': ')[0])).toEqual(['a.test.ts:2', 'a.test.ts:4', 'a.test.ts:6', 'a.test.ts:7', 'a.test.ts:9']);
  });

  it('leaves bounds of a second or more, non-clock values, and an allowance with its reason alone', () => {
    const text = [
      `const start = ${now('performance')};`,
      `expect(${now('performance')} - start)${bound(1500)};`,
      `expect(${now('performance')} - start)${bound('1_000')};`,
      `expect(bytes.length)${bound(400)};`,
      `expect(started.length)${bound(400)};`,
      `expect(${now('Date')} - t0)${bound(50)}; ${allow} emit only enqueues, no I/O at all`,
    ].join('\n');
    expect(subSecondClockBounds([['b.test.ts', text]])).toEqual([]);
  });

  it('still flags a bare allowance that does not say why', () => {
    const text = `expect(${now('Date')} - t0)${bound(50)}; ${allow}`;
    expect(subSecondClockBounds([['c.test.ts', text]])).toEqual([`c.test.ts:1: ${text}`]);
  });

  it('no tracked test asserts a sub-second wall-clock bound without saying why', () => {
    expect(subSecondClockBounds(trackedTests())).toEqual([]);
  });
});
