/**
 * A browser gate only looks for an accessible name the app (or the gate's own fixture) still renders.
 *
 * #1175 moved the folder trail from the folder page into the page bar and dropped `aria-label="Folder trail"`.
 * Its unit test followed; two gates did not, and main went red after merge with a 30-second locator timeout.
 * A gate's literal name is checked here, in pr fast: it must appear in the app's source, start with a template
 * or concatenation prefix the source builds names from (`Open folder ${title}`, 'Name ' + key), or be
 * authored by the gates' own fixtures.
 * Assertions that a name is ABSENT (`toHaveCount(0)`, `count() === 0`) are exempt: a retired name is their point.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist', '__tests__', '.vite']);

function files(dir, pattern, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, pattern, out);
    else if (pattern.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) out.push(full);
  }
  return out;
}
const read = (list) => list.map((file) => readFileSync(file, 'utf8')).join('\n');

const gateFiles = readdirSync(path.join(ROOT, 'scripts/gates'))
  .filter((name) => name.startsWith('gate-')).map((name) => path.join(ROOT, 'scripts/gates', name));
const appSource = read(files(path.join(ROOT, 'services'), /\.(tsx?|mjs|js|html)$/));
const scriptSource = read(files(path.join(ROOT, 'scripts'), /\.(mjs|js|html)$/));
// A name built at runtime: `Open folder ${title}` or 'Name ' + key.
const templateHeads = [...`${appSource}\n${scriptSource}`.matchAll(/`([A-Za-z][^`$\n]{2,})\$\{|'([A-Za-z][^'\n]{2,})' ?\+/g)]
  .map((m) => m[1] ?? m[2]);

const SELECTORS = [
  { re: /\[aria-label="([^"$`{}]+)"\]/g, as: (l) => `[aria-label="${l}"]` },
  { re: /getByLabel\('([^'$`{}]+)'/g, as: (l) => `getByLabel('${l}'` },
  { re: /getByRole\('[a-z]+', ?\{ ?name: '([^'$`{}]+)'/g, as: (l) => `name: '${l}'` },
];
const ABSENT = /toHaveCount\(0\)|count\(\)\)? ?=== ?0|\.toBeNull\(\)/;

function wantedLabels() {
  const wanted = [];
  for (const file of gateFiles) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (ABSENT.test(line)) continue;
      for (const { re } of SELECTORS) for (const m of line.matchAll(re)) wanted.push({ label: m[1], gate: path.basename(file) });
    }
  }
  return wanted;
}

function authoredByScripts(label) {
  const total = scriptSource.split(label).length - 1;
  const asSelector = SELECTORS.reduce((n, { as }) => n + scriptSource.split(as(label)).length - 1, 0);
  return total > asSelector;
}

describe('browser gate accessible names', () => {
  it('reads every literal name from the gates', () => {
    expect(wantedLabels().length).toBeGreaterThan(100);
  });

  it('only looks for names the app or its own fixture renders', () => {
    const missing = wantedLabels().filter(({ label }) => !appSource.includes(label)
      && !templateHeads.some((head) => label.startsWith(head))
      && !authoredByScripts(label));
    expect(missing.map(({ label, gate }) => `${gate}: "${label}"`)).toEqual([]);
  });

  it('would have caught the retired folder trail', () => {
    expect(appSource.includes('Folder trail')).toBe(false);
    expect(authoredByScripts('Folder trail')).toBe(false);
  });
});
