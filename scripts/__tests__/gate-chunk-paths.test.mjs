/**
 * A SCRIPT THAT COUNTS THE APP'S BUILT CHUNKS COUNTS THEM WHERE THE BUILD SERVES THEM. #1236 moved the Vite build from
 * /assets/ to /af/app/ (contracts url-space APP_BUILD_PREFIX); gate-reader-shell kept matching `/assets/TooltipPopper-*.js`,
 * so its "never fetched" checks passed vacuously and its "loaded once" check could never pass, and pr fast had no
 * browser to notice. Every hashed-chunk pattern under scripts/ (`<Name>-[^/]+\.js`) names the served prefix and a
 * module that exists, and the build's assets dir is that prefix.
 */
import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const file = `${dir}/${entry.name}`;
  if (entry.isDirectory()) return ['__tests__', 'fixtures', 'node_modules'].includes(entry.name) ? [] : walk(file);
  return /\.m?[jt]sx?$/.test(entry.name) ? [file] : [];
});
const prefix = read('services/contracts/src/url-space.ts').match(/const APP_BUILD_PREFIX = '([^']+)'/)?.[1];
const escaped = prefix.replace(/\//g, '\\/');
const solidModules = new Set(walk('services/app/solid').map((file) => path.basename(file).replace(/\.\w+$/, '')));
// A regex naming hashed build chunks: `Name-[^/]+\.js`, or `(?:A|B)-[^/]+\.js`.
const CHUNK = /(\(\?:[A-Z][\w|]*\)|[A-Z]\w*)-\[\^\/\]\+\\\.(?:js|css)/g;

it('the build serves its chunks under the contract prefix', () => {
  expect(prefix).toMatch(/^\/[\w/]+\/$/);
  expect(`/${read('vite.config.mts').match(/const APP_ASSETS_DIR = '([^']+)'/)?.[1]}/`).toBe(prefix);
});

it('every chunk pattern under scripts/ sits under that prefix and names a module that exists', () => {
  const problems = [];
  let seen = 0;
  for (const file of walk('scripts')) {
    read(file).split('\n').forEach((line, index) => {
      for (const match of line.matchAll(CHUNK)) {
        seen++;
        const where = `${file}:${index + 1}`;
        if (!line.slice(0, match.index).endsWith(escaped) && !line.slice(0, match.index).endsWith(`${escaped}(?:`)) problems.push(`${where} matches ${match[0]} outside ${prefix}`);
        for (const name of match[1].replace(/^\(\?:|\)$/g, '').split('|')) if (!solidModules.has(name)) problems.push(`${where} names chunk ${name}, which no services/app/solid module builds`);
      }
    });
  }
  expect(problems).toEqual([]);
  expect(seen, 'the scan sees gate-reader-shell\'s chunk patterns').toBeGreaterThanOrEqual(2);
});
