/**
 * NO AUTHOR CODE RUNS ON THE SERVER. A page reads and writes datasets only (its `sql`, the deprecated GraphQL), and the
 * dataset's rules are the only check on a write. This guard fails when anything of the removed page functions comes
 * back: a function door (`/fn/`), a capability handed to author code (`caps.sql`, `caps.fetch`…), a resolver link or
 * source field, the runner, page schedules, the page-function viewer connection or their settings, in the product's
 * source, its routes, its URL map or its workflows. Tests are not scanned (they may assert the absence).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { URL_SPACE } from '@artifactbin/contracts';
import { ROUTES } from '@/server/routes.generated';
import { REPO_ROOT, sourceFiles } from '@/test/helpers/source-files';

const RETURNED: Array<[RegExp, string]> = [
  [/\/fn\//, 'a page function door (/fn/NAME)'],
  [/\bcaps\.(?:sql|query|fetch|db|secrets|store)\b/, 'a capability handed to author code (caps.*)'],
  [/\baf-resolver\b|\bresolverSources\b/, 'a resolver link or source field'],
  [/@artifactbin\/runner\b|services\/runner\//, 'the runner service'],
  [/lib\/(?:html-backends|html-backend-secrets|function-schedules|data-services)\b/, 'a removed page-function module'],
  [/\b(?:RUNNER|SCHEDULES|DATA_SERVICES)__[A-Z]/, 'a runner, schedule or viewer-connection setting'],
  [/\bissueViewerToken\b|\bVIEWER_CONNECTION_KIND\b/, 'the page-function viewer connection'],
];
/** Product source: every package's code, the app's skill scripts and starters, the server entry and the workflows. */
const files = [
  ...sourceFiles(path.join(REPO_ROOT, 'services'), { extensions: /\.(?:ts|tsx|mjs|js|html)$/, skip: ['test', 'testing'] }),
  path.join(REPO_ROOT, 'server.ts'),
  ...sourceFiles(path.join(REPO_ROOT, '.github/workflows'), { extensions: /\.ya?ml$/ }),
];

describe('author code stays off the server', () => {
  it('scans the product (the scan is not vacuous)', () => {
    const relative = files.map((file) => path.relative(REPO_ROOT, file));
    expect(relative).toEqual(expect.arrayContaining(['server.ts', 'services/app/lib/page-doors/index.ts',
      'services/app/skills/artifactbin/examples/tracker.html', '.github/workflows/pr-fast.yml']));
  });
  it('names no page function, capability, resolver, runner, schedule or viewer connection anywhere in it', () => {
    const found = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return RETURNED.filter(([pattern]) => pattern.test(text)).map(([, what]) => `${path.relative(REPO_ROOT, file)}: ${what}`);
    });
    expect(found).toEqual([]);
  });
  it('routes no function, resolver-secret, runner or schedule door, and the URL map lists none', () => {
    expect(ROUTES.map((route) => route.path).filter((route) => /\/fn\/|\/resolvers\b|\/runner\/|\/schedules\b/.test(route))).toEqual([]);
    expect(URL_SPACE.page.doors.filter((door) => /^fn\b|resolvers|schedules/.test(door))).toEqual([]);
  });
  it('ships no runner package or page-function module', () => {
    for (const dir of ['services/runner', 'services/app/lib/html-backends', 'services/app/lib/html-backend-secrets',
      'services/app/lib/function-schedules', 'services/app/lib/data-services', '.github/workflows/runner-design.yml'])
      expect(existsSync(path.join(REPO_ROOT, dir)), dir).toBe(false);
  });
});
