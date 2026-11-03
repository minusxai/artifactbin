/**
 * THE TESTS THAT LAUNCH REAL CHROMIUM, found by reading them. Only CI's `integration` job installs Chromium, so
 * vitest.config.ts runs these in `integration` and leaves them out of `node`; a new one moves there by itself.
 * A file launches Chromium when it imports the in-process renderer (`@artifactbin/browser/local`) or calls
 * `chromium.launch(`. Playwright's API `request` client, a comment and a module name inside a string list are not launches.
 */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LAUNCHES_CHROMIUM = /^\s*import\b[^;]*?['"]@artifactbin\/browser\/local['"]|\bchromium\.launch\(/m;

/** @param {string} source Comments that open a line are not code, so a mention there is not a launch. */
export const launchesChromium = (source) => LAUNCHES_CHROMIUM.test(source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, ''));

/** Repository-relative test files under `include` (minus `exclude`) that launch Chromium. */
export function chromiumTests(root, include, exclude = ['**/node_modules/**']) {
  return globSync(include, { cwd: root, exclude })
    .filter((file) => launchesChromium(readFileSync(path.join(root, file), 'utf8')))
    .map((file) => file.split(path.sep).join('/'))
    .sort();
}
