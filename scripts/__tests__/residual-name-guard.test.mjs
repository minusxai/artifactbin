/**
 * THE REPOSITORY'S ONE TEXT GUARD.
 *
 * Everything here answers the same question — what may and may not be written down anywhere in the
 * tree — so it lives in one file rather than being spread over a dozen `not.toContain` lines in tests
 * that are about something else entirely:
 *
 *   - the pre-rename product identity;
 *   - the retired token surfaces, which used to be asserted absent inside proxy, CLI and eval tests
 *     that were really about rate limits, config and instrumentation;
 *   - identifiers spelled like a credential, which trip CodeQL's heuristic and redden every PR;
 *   - the README front door and the onboarding defects (one port story, no stale text).
 *
 * A guard has to be shown to bite: each scanner here is a pure function, exercised once against a
 * synthetic violation and once against the real tree. A guard that only ever sees a clean repository
 * is indistinguishable from a guard that does nothing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
/**
 * The pre-rename product identity, in every spelling: hyphen, space or underscore, any case, British, and the
 * plural typo. Only `artifact_bin`, exactly, is the retained database/schema name. Assembled from parts so this
 * file does not spell what it forbids.
 */
const RESIDUAL_NAME = new RegExp(['(?:artifact|artefact)(?:-|[ _])bin', ['artifacts', 'bin'].join('')].join('|'), 'gi');

/** Pure so a synthetic violation can prove the scan bites. `files` is a list of `[path, text]`. */
function residualNames(files) {
  const found = [];
  for (const [file, text] of files) {
    for (const match of text.matchAll(RESIDUAL_NAME)) {
      if (match[0] === ['artifact', 'bin'].join('_')) continue;
      found.push(`${file}:${text.slice(0, match.index).split('\n').length}: ${match[0]}`);
    }
  }
  return found;
}

describe('residual-name guard', () => {
  it('rejects historical, British, underscore/case, and plural-typo spellings', () => {
    const variants = [
      ['artifact', 'bin'].join('-'),
      ['Artifact', 'Bin'].join(' '),
      ['ARTIFACT', 'BIN'].join('_'),
      ['artefact', 'bin'].join('-'),
      ['Artefact', 'Bin'].join(' '),
      ['ARTEFACT', 'BIN'].join('_'),
      ['artifacts', 'bin'].join(''),
      ['Artifacts', 'bin'].join(''),
    ];
    expect(residualNames([['identity.txt', variants.join('\n')]])).toEqual(variants.map((variant, index) => `identity.txt:${index + 1}: ${variant}`));
  });

  it('keeps the exact retained database name and the current name', () => {
    expect(residualNames([['schema.sql', `CREATE SCHEMA ${['artifact', 'bin'].join('_')};\nartifactbin`]])).toEqual([]);
  });

  it('no tracked file spells the pre-rename identity', () => {
    expect(residualNames(trackedText())).toEqual([]);
  });
});

/**
 * The token-only model left no public mint and no token page: the CLI's OAuth approval is
 * the one thing that issues a credential. These strings named the surfaces that used to do it. Nothing
 * the product ships or documents may name them again — an agent that reads one sends a user to a 404.
 *
 * Tests, recorded transcripts and the gate that asserts the route is gone are exactly where these
 * strings SHOULD still appear, so the scan reads shipping sources only.
 */
const RETIRED_TOKEN_SURFACES = ['/tokens/new', '/api/tokens/anonymous', 'tokens/anonymous', '/settings/tokens'];
const NOT_SHIPPED = /(^|\/)(__tests__|test|tests|fixtures)(\/|$)|\.jsonl$|^scripts\/gates\//;

/**
 * A variable NAME must not be spelled like a key. CodeQL's credential heuristic treats such an
 * identifier as a secret, so the error message that names WHICH key to set ("FIREWORKS_API_KEY is not
 * set") is reported as clear-text logging of a credential — high severity, on every PR. The rename was
 * made once and undone by a later refactor, and the alert came back; hence a guard rather than a style
 * rule. `apiKey` itself is allowed: it holds the real secret, is scrubbed from everything written or
 * printed, and reaches no sink. So is the user-facing `--api-key-env` flag, which is a string literal.
 *
 * Scoped to `evals/`, where the alert fires. The app's generation config declares `apiKeyEnv` on its
 * model records and is not covered by this rule.
 */
const CREDENTIAL_SHAPED_IDENTIFIER = /\bapiKey(Env|Name|Var)[A-Za-z0-9_]*\b/;
const CREDENTIAL_RULE_APPLIES = /^evals\//;

/** Pure so a synthetic violation can prove the scan bites. `files` is a list of `[path, text]`. */
function retiredSurfaces(files) {
  const found = [];
  for (const [file, text] of files) {
    if (NOT_SHIPPED.test(file)) continue;
    text.split('\n').forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      for (const surface of RETIRED_TOKEN_SURFACES) if (line.includes(surface)) found.push(`${where}  ${surface}`);
      if (!CREDENTIAL_RULE_APPLIES.test(file)) return;
      const comment = line.trimStart();
      if (comment.startsWith('*') || comment.startsWith('//') || comment.startsWith('#')) return;
      if (CREDENTIAL_SHAPED_IDENTIFIER.test(line)) found.push(`${where}  credential-shaped identifier`);
    });
  }
  return found;
}

const trackedText = () => execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .flatMap((file) => {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch { return []; }
    return text.includes('\0') ? [] : [[file, text]];
  });

describe('retired surfaces', () => {
  it('finds a reintroduced token surface and a credential-shaped identifier, wherever they are written', () => {
    expect(retiredSurfaces([['services/app/lib/copy.ts', 'const hint = "get one at /tokens/new";']]))
      .toEqual(['services/app/lib/copy.ts:1  /tokens/new']);
    expect(retiredSurfaces([['docs/publishing.md', 'POST /api/tokens/anonymous']]))
      .toEqual(['docs/publishing.md:1  /api/tokens/anonymous', 'docs/publishing.md:1  tokens/anonymous']);
    expect(retiredSurfaces([['evals/lib/run.ts', 'const apiKeyEnv = model.env;']]))
      .toEqual(['evals/lib/run.ts:1  credential-shaped identifier']);
  });

  it('leaves tests, recorded transcripts and the route-is-gone gate alone', () => {
    const elsewhere = [
      ['services/proxy/__tests__/doors.test.ts', "expect(text).not.toContain('/tokens/new');"],
      ['evals/__tests__/fixtures/codex.deck.jsonl', '{"output":"https://example.test/tokens/new"}'],
      ['scripts/gates/gate-simpler-start.mjs', "await fetch(`${B}/api/tokens/anonymous`, { method: 'POST' })"],
      ['evals/lib/run.ts', '// apiKeyEnv was renamed; see the guard'],
    ];
    expect(retiredSurfaces(elsewhere)).toEqual([]);
  });

  it('no shipping source or document names a retired token surface, or spells a variable like a key', () => {
    expect(retiredSurfaces(trackedText())).toEqual([]);
  });
});

/** THE README IS A FRONT DOOR: four sections in order, the two one-liners, no retired env name. */
const readme = () => read('README.md');
/** The one place the default host is spelled (services/contracts); prose that names it is checked against this. */
// The flat settings this product retired; the boot-time alias map is gone (no backward compatibility), so the
// list lives in the guards that keep the names from coming back (see services/app/lib/__tests__/retired-names.test.ts).
const retiredEnvNames = () => [
  'ADMIN_SECRET', 'AUTH_SECRET', 'PUBLIC_BASE_URL', 'PORT', 'RESEND_API_KEY', 'MIXPANEL_TOKEN',
  'TRUSTED_PROXY_HOPS', 'QUERY_TIMEOUT_MS', 'MAX_QUERY_ROWS', 'LOCAL_OBJECT_DIR',
];

describe('README.md', () => {
  it('is short and keeps the main sections in order', () => {
    expect(readme().split('\n').length).toBeLessThanOrEqual(90);
    expect(readme().split('\n').filter((l) => /^## /.test(l))).toEqual(['## Author a document', '## Develop', '## Modules and documentation']);
    expect(readme().split('\n')[0]).toBe('# Artifactbin');
  });
  it('documents skill installation and real HTTP authoring',()=>{
    for(const text of ['/llms.txt','/skills/artifactbin.zip','/llms/http-auth','POST /api/artifacts','npm run setup -- --yes --port 7445','Apache-2.0'])expect(readme()).toContain(text);
    expect(readme()).not.toMatch(/chat\/install|@afbin\/cli|afbin auth|afbin push/);
  });
});

describe('SETUP.md', () => {
  it('source onboarding pulls by the published ID and preserves local edits', () => {
    const onboarding = read('SETUP.md');
    expect(onboarding).toContain('node scripts/read.mjs <published-id> --output page.html');
    expect(onboarding).toContain('returned by `publish.mjs`');
    expect(onboarding).toContain('preserve any unpublished local edits');
    expect(onboarding).not.toMatch(/npm run afbin|afbin (?:pull|push)/);
  });
  it('is linked from the README', () => {
    expect(readme()).toContain('(SETUP.md)');
  });
  it('SETUP.md and .env.example speak only namespaced names', () => {
    for (const file of ['SETUP.md', '.env.example']) {
      for (const n of retiredEnvNames()) expect(read(file), `${file} ${n}`).not.toMatch(new RegExp(`(^|[^A-Z_])${n}=`, 'm'));
    }
  });
});

describe('license', () => {
  it('the root package.json declares Apache-2.0 like every service does', () => {
    expect(JSON.parse(read('package.json')).license).toBe('Apache-2.0');
  });
});

/** THE ONBOARDING DEFECTS: one port story, no stale text, a generator hint for every secret. */
describe('one port story', () => {
  it('config.ts falls back to the same default port as dev-env.mjs (3030)', () => {
    const src = read('services', 'app', 'lib', 'platform', 'config.ts');
    expect(src).not.toMatch(/PUBLIC_BASE_URL[^\n]*\?\?\s*'http:\/\/localhost:3000'/);
    expect(src).toMatch(/PUBLIC_BASE_URL[^\n]*3030|APP__PORT[^\n]*3030/);
  });
  it('AGENTS.md agrees: npm run dev is on 3030', () => {
    const line = read('AGENTS.md').split('\n').find((l) => /npm run dev\b/.test(l) && /localhost:\d+/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain('localhost:3030');
  });
});

describe('no stale text, no dead code', () => {
  it('config.ts no longer claims the runner refuses to start on retired names', () => {
    expect(read('services', 'app', 'lib', 'platform', 'config.ts')).not.toMatch(/REFUSES TO START/);
  });
  it('.env.example gives a generator hint for ADMIN__SECRET too', () => {
    const lines = read('.env.example').split('\n');
    const i = lines.findIndex((l) => /^ADMIN__SECRET=/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(lines.slice(Math.max(0, i - 4), i).join('\n')).toMatch(/openssl rand -base64 32|npm run setup/);
  });
});

/**
 * NO OTHER PRODUCT BY NAME. This product integrates with other services only through generic mechanisms (identity
 * tokens for a configured audience, viewer connections to a configured data service, the identity read views), so no
 * source file, setting, route, generated SQL, skill file or document names the downstream data product those were
 * first built for. The allowlist is three spellings that are not that product:
 *   - the GitHub organisation that owns this repository and its deployment and eval repositories (`<name>ai`);
 *   - the company's mail domain (`<name>.ai`: the security contact, test addresses);
 *   - the shipped chart recipe namespace (`<name>/<recipe>@<version>` and its quoted prefix), stored inside
 *     published pages, so renaming it is a data migration, not a text edit.
 * Assembled from parts so this file does not spell what it forbids.
 */
const OTHER_PRODUCT = ['minus', 'x'].join('');
const OTHER_PRODUCT_NAME = new RegExp(OTHER_PRODUCT, 'gi');
const OTHER_PRODUCT_ALLOWED = [
  new RegExp(`${OTHER_PRODUCT}ai\\b`, 'iy'),
  new RegExp(`${OTHER_PRODUCT}\\.ai\\b`, 'iy'),
  new RegExp(`${OTHER_PRODUCT}/[a-z0-9-]+@\\d+`, 'y'),
  new RegExp(`${OTHER_PRODUCT}/'`, 'y'),
];

/** Pure so a synthetic violation can prove the scan bites. `files` is a list of `[path, text]`. */
function otherProductNames(files) {
  const found = [];
  for (const [file, text] of files) {
    if (OTHER_PRODUCT_NAME.test(file)) found.push(`${file}: in the path`);
    OTHER_PRODUCT_NAME.lastIndex = 0;
    for (const match of text.matchAll(OTHER_PRODUCT_NAME)) {
      if (OTHER_PRODUCT_ALLOWED.some((allowed) => { allowed.lastIndex = match.index; return allowed.test(text); })) continue;
      found.push(`${file}:${text.slice(0, match.index).split('\n').length}: ${match[0]}`);
    }
  }
  return found;
}

describe('no other product by name', () => {
  it('finds the name in a setting, a route, a kind, a path or prose, in any case', () => {
    const name = OTHER_PRODUCT, title = name[0].toUpperCase() + name.slice(1, 5) + name[5].toUpperCase();
    const files = [
      ['services/app/lib/platform/config.ts', `env('${name.toUpperCase()}', 'BASE_URL');`],
      ['services/app/server/routes.generated.ts', `'/api/my/${name}/connections'`],
      ['services/contracts/src/kinds.ts', `export const KIND = '${name}';`],
      [`services/app/skills/artifactbin/scripts/${name}.mjs`, ''],
      ['README.md', `Pages read ${title} data.`],
    ];
    expect(otherProductNames(files)).toEqual([
      'services/app/lib/platform/config.ts:1: ' + name.toUpperCase(),
      'services/app/server/routes.generated.ts:1: ' + name,
      'services/contracts/src/kinds.ts:1: ' + name,
      `services/app/skills/artifactbin/scripts/${name}.mjs: in the path`,
      'README.md:1: ' + title,
    ]);
  });

  it('allows only the organisation, the mail domain and the chart recipe namespace', () => {
    const name = OTHER_PRODUCT;
    expect(otherProductNames([['a.md', `https://github.com/${name}ai/artifactbin\nsecurity@${name}.ai\n{recipe: '${name}/funnel@1'}\nstartsWith('${name}/')`]])).toEqual([]);
    expect(otherProductNames([['a.md', `${name}/funnel`]])).toEqual(['a.md:1: ' + name]);
  });

  it('no tracked file names it', () => {
    expect(otherProductNames(trackedText())).toEqual([]);
  });
});
