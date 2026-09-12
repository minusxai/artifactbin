/**
 * RETIRED NAMES ARE DEAD NAMES — one table, one walker, one non-vacuity proof.
 *
 * Nine separate guards used to assert this, each with a private copy of the same directory walker
 * and its own copy of the case *"is actually looking at something"*. The rule they share is the
 * one below: a name this product retired must not survive as a LIVE USE anywhere in the tree, even
 * though prose about the retirement may still name it. Each row keeps the incident that taught it,
 * because that is what makes the row readable rather than arbitrary.
 *
 * A row is a lint over source text. What the retired thing is REPLACED BY is asserted separately,
 * at the bottom — a dead name and a live vocabulary are two different claims.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTERNAL_MINT_PATH } from '@artifactbin/contracts';
import { APP_ROOT, REPO_ROOT, codeOf, sourceFiles } from '@/test/helpers/source-files';

/**
 * The flat, un-namespaced settings this product retired. The map that once translated them at boot is gone
 * (no backward compatibility), so the list lives here: a retired name must not be SET anywhere in the tree.
 */
const RETIRED_ENV_NAMES = [
  'ADMIN_SECRET', 'ARTIFACT_QUOTA_PER_TOKEN', 'AUTH_SECRET', 'BROWSER__WS_URL', 'EVENTS__DATABASE_URL',
  'APP__INTERNAL_ORIGIN', 'CONTRACT__ACTOR_SECRET', 'EXPORT_INTERNAL_ORIGIN', 'INVITE__CODE', 'LOCAL_OBJECT_DIR',
  'LOGIN_EMAIL_FROM', 'MAX_EXTERNAL_IMAGES_PER_PUBLISH', 'MAX_IMAGE_BYTES', 'MAX_QUERY_ROWS', 'MAX_ROWS_LIMIT',
  'MIXPANEL_HOST', 'MIXPANEL_TOKEN', 'MUTATION_MAX_PER_MINUTE', 'PORT', 'PUBLIC_BASE_URL', 'QUERY_TIMEOUT_MS',
  'RESEND_API_KEY', 'RESEND_BASE_URL', 'TRUSTED_PROXY_HOPS', 'WEB_INGEST_ALLOW_PRIVATE', 'WEB_INGEST_MAX_PER_HOUR',
  'WEB_INGEST_TIMEOUT_MS', 'WAITLIST__WEBHOOK_URL',
];

interface Scan {
  /** Why this name is dead, in one line. */
  label: string;
  /** Directories walked, relative to the repository root. */
  dirs: string[];
  /** Beyond `.ts`/`.tsx`. */
  extensions?: RegExp;
  /** A line of CODE (comments already stripped) matching this is an offence. */
  pattern: RegExp;
  /** The files allowed to name it — the alias table, the rejection hint, the route that serves it. */
  allow?: string[];
  /** Proof the walk found what it is meant to judge: a floor, and one file that must be in it. */
  proof: { atLeast: number; contains: string };
}

const APP = path.relative(REPO_ROOT, APP_ROOT);
const rel = (file: string) => path.relative(REPO_ROOT, file);

const SCANS: Scan[] = [
  {
    // `/api` was the docs endpoint; it moved to `/docs` and answers 404. Cleaning it up by grep
    // missed HeaderBar's "0 artifacts — point an agent at /api", which shipped to production and
    // was found by clicking around rather than by any test.
    label: 'nothing links to /api — it moved to /docs and answers 404',
    dirs: [`${APP}/app`, `${APP}/components`],
    pattern: /href=(?:"\/api"|\{`\/api`\}|'\/api')/,
    proof: { atLeast: 20, contains: `${APP}/components` },
  },
  {
    // The theme lineup is six dual-palette themes. The retirement touched the registry, the publish
    // gate, the docs, the guidance yaml, the seeds and the gates — a leftover in any one of them is
    // a contract an agent will believe.
    label: 'no retired theme name is used as a value outside the alias table',
    dirs: [`${APP}/app`, `${APP}/components`, `${APP}/lib`, 'scripts'],
    extensions: /\.(tsx?|mjs)$/,
    pattern: /['"](classical|broadsheet|nocturne)['"]/,
    allow: [`${APP}/lib/data/story/story-themes.ts`],
    proof: { atLeast: 50, contains: `${APP}/lib/data/story/story-themes.ts` },
  },
  {
    // Two generations of docs addresses answer 404 with no alias: the pre-tree pages and the
    // six-skill tree's directories. They were hard-coded in a dozen places that are NOT generated.
    label: 'no live address names a retired docs page',
    dirs: [`${APP}/app`, `${APP}/components`, `${APP}/lib`, `${APP}/server`, `${APP}/web`, 'scripts', 'evals', '.github'],
    extensions: /\.(tsx?|mjs|ya?ml)$/,
    pattern: /\/docs\/(?:llm|artifact-design|publishing|markup|themes|templates|design)(?![\w-])/,
    allow: [`${APP}/server/routes.generated.ts`],
    proof: { atLeast: 50, contains: `${APP}/lib` },
  },
  {
    // There is ONE document format. `html` and `markdown` are not formats, not inputs and not wire
    // fields. The retirement touched the input parser, the wire echo, the pages, the editor and
    // five docs sections; `format: 'html'` survived in a colour map past all of them.
    label: 'no source file treats html or markdown as a format',
    dirs: [`${APP}/app`, `${APP}/components`, `${APP}/lib`],
    pattern: new RegExp([
      /format\s*(?::|===|==|!==)\s*'html'/, /ArtifactFormat\s*=\s*[^;]*'html'/, /body\.(html|markdown)\b/,
      /format\s*\?\?\s*'html'/, /default:\s*"'html'"/, /format IN \([^)]*'html'/,
      /FormatBadge format="(html|markdown)"/, /\bhtml:\s*(row|artifact)\.content/,
      /^\s*html:\s*(content|row\.content|artifact\.content)/, /^\s*(html|markdown):\s*['"]/,
    ].map((r) => r.source).join('|'), 'm'),
    allow: [`${APP}/lib/story/input.ts`],
    proof: { atLeast: 50, contains: `${APP}/lib/story/input.ts` },
  },
  {
    // The mint has one address and it is internal. `/api/tokens/anonymous` is gone: no public route
    // mints, and no string under services/app names it any more.
    label: 'the retired public mint address is named nowhere at all',
    dirs: [APP],
    pattern: /tokens\/anonymous/,
    proof: { atLeast: 100, contains: `${APP}/lib` },
  },
  {
    // What replaced it is refused at the edge by the proxy, so the only place that address may
    // appear is the route that serves it, the generated route table, and the contract.
    label: 'the internal mint address is named only where it is served',
    dirs: [APP],
    pattern: new RegExp(INTERNAL_MINT_PATH.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')),
    allow: [`${APP}/server/routes.generated.ts`, `${APP}/app/api/internal/tokens/route.ts`],
    proof: { atLeast: 100, contains: `${APP}/app/api/internal/tokens/route.ts` },
  },
  {
    // The human docs address is `/docs-human`, everywhere a person can click; `/docs` and below are
    // agents' only.
    label: 'no current code names the retired /docs/human address',
    dirs: [`${APP}/app`, `${APP}/components`, `${APP}/lib`, `${APP}/server`, `${APP}/web`],
    pattern: /\/docs\/human/,
    proof: { atLeast: 50, contains: `${APP}/web` },
  },
];

/** The files one scan judges, with their comments already removed. */
const scanned = (scan: Scan): Array<[string, string]> =>
  scan.dirs
    .flatMap((dir) => sourceFiles(path.join(REPO_ROOT, dir), scan.extensions ? { extensions: scan.extensions } : {}))
    .filter((file) => !/routes\.generated\.ts$/.test(file) || (scan.allow ?? []).includes(rel(file)))
    .map((file) => [rel(file), codeOf(readFileSync(file, 'utf8'))]);

describe('retired names are dead names', () => {
  it.each(SCANS.map((scan) => [scan.label, scan] as const))('%s', (_label, scan) => {
    const allow = new Set(scan.allow ?? []);
    const offenders: string[] = [];
    for (const [file, code] of scanned(scan)) {
      if (allow.has(file)) continue;
      code.split('\n').forEach((line, i) => {
        if (scan.pattern.test(line)) offenders.push(`${file}:${i + 1} — ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * THE one non-vacuity assertion. Every row above is an absence, and an absence over an empty walk
   * is green forever — a renamed or moved directory is exactly how that happens. Nine copies of this
   * case existed because nine copies of the walker did.
   */
  it('every scan is actually looking at something (no row can silently find nothing)', () => {
    for (const scan of SCANS) {
      const files = scanned(scan).map(([file]) => file);
      expect(files.length, scan.label).toBeGreaterThanOrEqual(scan.proof.atLeast);
      expect(files.some((file) => file.startsWith(scan.proof.contains)), `${scan.label}: ${scan.proof.contains}`).toBe(true);
    }
  });
});

/**
 * What replaced the dead names. A retired name being absent and the surviving vocabulary being
 * right are two different claims, and only the second one tells you what the product is.
 */
describe('the surviving vocabulary', () => {
  it('is exactly six themes, and the theme docs teach exactly those six', async () => {
    const { STORY_THEME_NAMES } = await import('@/lib/validation/atlas-schemas');
    expect([...STORY_THEME_NAMES]).toEqual(['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop']);
    const { readdirSync } = await import('node:fs');
    const documented = readdirSync(path.join(APP_ROOT, 'skills/artifactbin/references'))
      .filter((f) => f.startsWith('themes-'))
      .map((f) => f.replace(/^themes-/, '').replace(/\.md$/, ''))
      .sort();
    expect(documented).toEqual(['industry', 'manuscript', 'modernist', 'organic', 'pop', 'terminal']);
  });

  it('is exactly the surviving artifact formats', async () => {
    // The VALUE, not a regex over the declaration: the runtime list and the type are one
    // declaration now, so asserting the list asserts both.
    const { ARTIFACT_FORMATS } = await import('@/lib/story/input');
    expect([...ARTIFACT_FORMATS].sort()).toEqual(['dataset', 'file', 'folder', 'image', 'markup', 'pdf', 'viz']);
  });

  it('points every human link at /docs-human', () => {
    for (const file of ['components/LandingFooter.tsx', 'components/PageChrome.tsx', 'web/App.tsx', 'lib/story/reader-chrome.ts']) {
      expect(codeOf(readFileSync(path.join(APP_ROOT, file), 'utf8')), file).toContain('/docs-human');
    }
  });

  it('serves the docs without sniffing Accept, and ships a shell carrying no agent pointer of its own', () => {
    expect(codeOf(readFileSync(path.join(APP_ROOT, 'lib/skills/serve.ts'), 'utf8'))).not.toContain('text/html');
    const html = readFileSync(path.join(APP_ROOT, 'web/index.html'), 'utf8');
    expect(html).not.toContain('rel="help"');
    expect(html).not.toContain('name="afbin"');
  });
});

/**
 * A RATE LIMIT IS ENFORCED IN EXACTLY ONE PLACE (P2 §H). The proxy's policy file decides which
 * budgets a request spends and counts them before forwarding. An app-side helper counting the SAME
 * budget in the same co-hosted process halves the configured ceiling — a live bug this wave found.
 * The vocabulary of record is the shipped policy file, READ as a file: the app imports nothing from
 * the proxy package.
 */
describe('the app counts no door of its own', () => {
  const authSource = readFileSync(path.join(APP_ROOT, 'lib/auth.ts'), 'utf8');

  it('names none of the policies the proxy already counts, and makes no limiter call at all', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'services/proxy/default_rate_limits.yml'), 'utf8');
    const body = source.slice(source.indexOf('policies:'), source.indexOf('routes:'));
    const policies = [...body.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]!);
    // The vocabulary was READ, not guessed — and it is the one the proxy enforces.
    expect(policies).toContain('start_doc');
    expect(policies.length).toBeGreaterThan(5);
    for (const policy of policies) {
      expect(authSource, `lib/auth.ts names ${policy}, which the proxy already counts`).not.toMatch(new RegExp(`['"\`]${policy}['"\`]`));
    }
    expect([...authSource.matchAll(/\.(limit|check|hit)\(\s*'?([A-Za-z_]*)/g)].map((m) => `${m[1]}(${m[2]})`)).toEqual([]);
  });

  it('serves the internal mint with no limiter call, and holds no rate-limit engine or retired auth helper', () => {
    const mint = readFileSync(path.join(APP_ROOT, 'app/api/internal/tokens/route.ts'), 'utf8');
    expect(mint).not.toMatch(/\.limit\(|\.check\(/);
    expect(mint).not.toMatch(/mutationRateLimited|rateLimited/);
    for (const gone of ['lib/rate-limiter/index.ts', 'lib/rate-limiter/memory.ts', 'lib/rate-limiter/app.ts']) {
      expect(existsSync(path.join(APP_ROOT, gone)), gone).toBe(false);
    }
    for (const helper of ['hasAdminSecret', 'resetLimiter', 'ADMIN_SECRET']) expect(authSource).not.toContain(helper);
  });
});

/**
 * Retired SETTINGS, which are different from retired names in code: a setting nothing reads is
 * silently ignored rather than failing, so the scan covers every tracked file of every type,
 * including eval JSON. Retirement is scoped — proxy-owned settings and audit fixtures remain valid.
 */
describe('the retired env names', () => {
  // This file NAMES every retired setting, so it must exempt itself — derived from its own URL
  // rather than written as a literal, because a literal goes stale the moment the file is renamed
  // and the guard then flags ITSELF, which reads exactly like a real violation.
  const SELF = path.relative(REPO_ROOT, fileURLToPath(import.meta.url));
  const EXEMPT = new Set([
    'services/app/lib/config.ts',
    'services/app/lib/__tests__/env-namespacing.test.ts',
    SELF,
    'services/utils/__tests__/env.test.ts',
  ]);
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

  const names = RETIRED_ENV_NAMES.join('|');
  const declaration = new RegExp(`\\b(const|let|var)\\s+(${names})\\b`);
  const forbiddenSettings = (file: string, line: string): string[] => {
    const setters = new RegExp(`(^|[\\s"'{,\\-])(${names})["']?\\s*(=|:)`, 'gm');
    return [...line.matchAll(setters)].map((match) => match[2]!).filter((name) => !stillOwned(file, name));
  };

  it('finds quoted JSON settings outside the app, and no allowed setting masks a retired one on the same line', () => {
    expect(forbiddenSettings('evals/config.json', '{"ADMIN_SECRET": "x"}')).toEqual(['ADMIN_SECRET']);
    expect(forbiddenSettings('scripts/setup.mjs', "{ CONTRACT__ACTOR_SECRET: 'fixture', AUTH_SECRET: 'obsolete' }"))
      .toEqual(['AUTH_SECRET']);
    expect(forbiddenSettings('services/proxy/src/config.ts', 'INVITE__CODE=obsolete')).toEqual(['INVITE__CODE']);
  });

  it('are set by nothing this repo tracks', async () => {
    const { execFileSync } = await import('node:child_process');
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(tracked).toContain('evals/config.json');
    expect(tracked).toContain('services/utils/src/env.ts');
    const offenders: string[] = [];
    for (const file of tracked) {
      if (EXEMPT.has(file) || /^(docs|\.github\/ISSUE)/.test(file)) continue;
      let source: string;
      try { source = readFileSync(path.join(REPO_ROOT, file), 'utf8'); } catch { continue; }
      // A COMMENT naming the old spelling is documentation, not a setting.
      const live = source.split('\n')
        .filter((line) => !/^\s*(#|\/\/|\*)/.test(line))
        .filter((line) => !declaration.test(line));
      if (live.some((line) => forbiddenSettings(file, line).length > 0)) offenders.push(file);
    }
    expect(offenders, 'these set a name nothing reads — the value is silently ignored').toEqual([]);
  });
});
