/**
 * NOTHING IN THE REPO MAY SET A RETIRED ENV NAME — in any file type.
 *
 * The rename swept `.ts`, `.mjs`, `.yml` and the Dockerfile, and missed
 * `.json`. `evals/config.json` went on setting `ANON_MINT_MAX`, which nothing
 * reads any more, so the eval server booted with production's default of 0 and
 * every `/api/start` was refused — `agent smoke` failed on the PR while every
 * other job was green.
 *
 * So the check is over TRACKED FILES, whatever their extension, and it looks
 * for the shapes that SET a value: `NAME=`, `NAME:` and `"NAME":`. The two
 * files that legitimately name the retired spellings are exempt: the map
 * itself, and the tests that exercise the mechanism — the app's, and the one
 * for `createEnv` in @artifactbin/utils, which is the same audit for a
 * service (a retired name there is a FIXTURE it must be handed to assert that
 * the name is reported).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETIRED_ENV_NAMES } from '../config';

const ROOT = path.resolve(__dirname, '../..');
const EXEMPT = new Set([
  'lib/config.ts',
  'lib/__tests__/env-namespacing.test.ts',
  'lib/__tests__/no-retired-env-names.test.ts',
  'services/utils/__tests__/env.test.ts',
]);

describe('the retired env names', () => {
  it('are set by nothing this repo tracks', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const names = Object.keys(RETIRED_ENV_NAMES).join('|');
    // `NAME=` / `NAME:` / `"NAME":` — but not an unrelated local variable
    // that merely shares a spelling.
    const setters = new RegExp(`(^|[\\s"'{,\\-])(${names})\\s*(=|:)`, 'm');
    const declaration = new RegExp(`\\b(const|let|var)\\s+(${names})\\b`);
    const offenders: string[] = [];
    for (const rel of tracked) {
      if (EXEMPT.has(rel) || /^(docs|\.github\/ISSUE)/.test(rel)) continue;
      let src: string;
      try { src = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
      // A COMMENT naming the old spelling is documentation, not a setting.
      const live = src.split('\n')
        .filter((l) => !/^\s*(#|\/\/|\*)/.test(l))
        .filter((l) => !declaration.test(l));
      if (live.some((l) => setters.test(l))) offenders.push(rel);
    }
    expect(offenders, 'these set a name nothing reads — the value is silently ignored').toEqual([]);
  });
});
