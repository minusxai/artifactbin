/** Scan tracked files of every type for obsolete settings, including eval JSON.
 * Retirement is scoped: proxy-owned settings and intentional audit fixtures remain valid.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETIRED_ENV_NAMES } from '../config';

const ROOT = path.resolve(__dirname, '../../../..');
const EXEMPT = new Set([
  'services/app/lib/config.ts',
  'services/app/lib/__tests__/env-namespacing.test.ts',
  'services/app/lib/__tests__/no-retired-env-names.test.ts',
  'services/utils/__tests__/env.test.ts',
]);

// These names retired from app config still belong to the proxy/composition.
// Permit only the owning scope, not entire files or all non-app settings.
const proxyComposition = new Set([
  '.github/workflows/ci.yml', 'docker-compose.lean.yml',
  'scripts/__tests__/app-only-auth.test.mjs', 'scripts/__tests__/setup-plan.test.mjs',
  'scripts/agent-worktree.mjs', 'scripts/image-checks.mjs', 'scripts/lib/setup-plan.mjs', 'scripts/setup.mjs',
]);
const stillOwned = (file: string, name: string): boolean =>
  (name === 'CONTRACT__ACTOR_SECRET' && (file.startsWith('services/proxy/') || proxyComposition.has(file))) ||
  (['INVITE__CODE', 'WAITLIST__WEBHOOK_URL'].includes(name) && [
    'services/proxy/__tests__/login-routes.test.ts', 'services/proxy/__tests__/open-access.test.ts',
  ].includes(file));

const names = Object.keys(RETIRED_ENV_NAMES).join('|');
const declaration = new RegExp(`\\b(const|let|var)\\s+(${names})\\b`);
const forbiddenSettings = (file: string, line: string): string[] => {
  const setters = new RegExp(`(^|[\\s"'{,\\-])(${names})["']?\\s*(=|:)`, 'gm');
  return [...line.matchAll(setters)].map((match) => match[2]).filter((name) => !stillOwned(file, name));
};

describe('the retired env names', () => {
  it('finds quoted JSON settings outside the app', () => {
    expect(forbiddenSettings('evals/config.json', '{"ADMIN_SECRET": "x"}')).toEqual(['ADMIN_SECRET']);
  });
  it('does not let an allowed setting mask a retired setting on the same line', () => {
    expect(forbiddenSettings('scripts/setup.mjs', "{ CONTRACT__ACTOR_SECRET: 'fixture', AUTH_SECRET: 'obsolete' }"))
      .toEqual(['AUTH_SECRET']);
    expect(forbiddenSettings('services/proxy/src/config.ts', 'INVITE__CODE=obsolete')).toEqual(['INVITE__CODE']);
  });

  it('are set by nothing this repo tracks', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(tracked).toContain('evals/config.json');
    expect(tracked).toContain('services/utils/src/env.ts');
    const offenders: string[] = [];
    for (const rel of tracked) {
      if (EXEMPT.has(rel) || /^(docs|\.github\/ISSUE)/.test(rel)) continue;
      let src: string;
      try { src = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
      // A COMMENT naming the old spelling is documentation, not a setting.
      const live = src.split('\n')
        .filter((l) => !/^\s*(#|\/\/|\*)/.test(l))
        .filter((l) => !declaration.test(l));
      if (live.some((line) => forbiddenSettings(rel, line).length > 0)) offenders.push(rel);
    }
    expect(offenders, 'these set a name nothing reads — the value is silently ignored').toEqual([]);
  });
});
