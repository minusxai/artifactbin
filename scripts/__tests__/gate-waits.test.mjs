/**
 * A browser gate waits on a condition, never on the clock.
 *
 * main's `browser gates (1/9)` went red again and again on one race: live-regions read the viewer's text "before",
 * slept 500 ms, and compared, while the owner's last Backspaces were still on their way to the viewer. The snapshot
 * had waited for strings that were already there, not for the editors' last key to land. A fixed sleep cannot tell
 * "nothing more is coming" from "it has not come yet"; a poll on the condition can (`until(read, want)`).
 *
 * So the only `await sleep(` a gate may hold is a poll interval: inside a loop bounded by a deadline
 * (`while (Date.now() < …)`). Any other is pinned below, per file, with why it is not a race; the pins only shrink.
 * Lower a pin when you replace a sleep; a new fixed sleep fails here, in pr fast, before it can flake on main.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const GATE_DIR = path.resolve(import.meta.dirname, '..', 'gates');

/** File → fixed sleeps it may hold, and why each cannot fail a passing product. */
const PINNED = {
  // A negative window each: "no update leaves A while the composition is open", "what B types offline has not reached
  // A". Waiting longer can only make them stricter; they cannot fail while the product is right.
  'gate-live-regions.mjs': { count: 2, why: 'negative windows (IME composition open, B offline)' },
  'gate-live-regions-oop.mjs': { count: 1, why: 'negative window (IME composition open)' },
  // Paces twenty seconds of typing at a person's rhythm; every assertion after it polls.
  'gate-new-doc.mjs': { count: 1, why: 'paces typing; no assertion compares across it' },
  // A negative window: the page's forged messages spend no publication (no one else writes the page meanwhile).
  'gate-own-origin-script.mjs': { count: 1, why: 'negative window (forged messages do not move the version)' },
  // Debt, not yet a seen flake: a stability sample (8 × 100 ms) and two "click, 200 ms, measure" reads.
  'gate-reading-geometry.mjs': { count: 3, why: 'debt: layout stability sample and two post-click settles' },
};

/** Each `await sleep(` that is not the interval of a deadline-bounded poll loop. */
function fixedSleeps(source) {
  const found = [];
  for (const match of source.matchAll(/await\s+sleep\(/g)) {
    const around = source.slice(Math.max(0, match.index - 300), match.index + 160);
    if (/while\s*\(\s*Date\.now\(\)\s*</.test(around)) continue;
    found.push(source.slice(0, match.index).split('\n').length);
  }
  return found;
}

const gates = readdirSync(GATE_DIR).filter((name) => name.startsWith('gate-') && name.endsWith('.mjs')).sort();

describe('browser gates wait on conditions, not on the clock', () => {
  it('finds the gate scripts', () => {
    expect(gates).toEqual(expect.arrayContaining(['gate-live-regions.mjs', 'gate-new-doc.mjs']));
  });

  it('holds no fixed sleep outside the pinned, reasoned exceptions, and every pin is exact (pins only shrink)', () => {
    const actual = Object.fromEntries(gates.map((name) => [name, fixedSleeps(readFileSync(path.join(GATE_DIR, name), 'utf8'))]).filter(([, lines]) => lines.length));
    const counts = Object.fromEntries(Object.entries(actual).map(([name, lines]) => [name, lines.length]));
    const pinned = Object.fromEntries(Object.entries(PINNED).map(([name, { count }]) => [name, count]));
    expect(counts, `fixed sleeps by gate, at lines ${JSON.stringify(actual)}: poll the condition with until() instead`).toEqual(pinned);
  });

  it('tells a poll interval from a fixed sleep', () => {
    expect(fixedSleeps('do { value = await read(); if (want(value)) return value; await sleep(50); } while (Date.now() < end);')).toEqual([]);
    expect(fixedSleeps('while (Date.now() < deadline) {\n  last = await read();\n  if (want(last)) return last;\n  await sleep(100);\n}')).toEqual([]);
    // The race this guard was written for: a snapshot, a nap, a comparison.
    expect(fixedSleeps('const text = await textOf(c);\nawait C.keyboard.type("keys");\nawait sleep(500);\ncheck(await textOf(c) === text);')).toEqual([3]);
  });
});
