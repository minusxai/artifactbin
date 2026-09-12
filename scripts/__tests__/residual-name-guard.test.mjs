/**
 * THE REPOSITORY'S ONE TEXT GUARD.
 *
 * Everything here answers the same question — what may and may not be written down anywhere in the
 * tree — so it lives in one file rather than being spread over a dozen `not.toContain` lines in tests
 * that are about something else entirely:
 *
 *   - the pre-rename product identity (the `check-residual-names.mjs` binary and its allowlist);
 *   - the retired token surfaces, which used to be asserted absent inside proxy, CLI and eval tests
 *     that were really about rate limits, config and instrumentation;
 *   - identifiers spelled like a credential, which trip CodeQL's heuristic and redden every PR;
 *   - the README front door and the onboarding defects (one port story, no stale text).
 *
 * A guard has to be shown to bite: each scanner here is a pure function, exercised once against a
 * synthetic violation and once against the real tree. A guard that only ever sees a clean repository
 * is indistinguishable from a guard that does nothing.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(ROOT, 'scripts', 'check-residual-names.mjs');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function repository(files, allowlist = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifactbin-residual-'));
  temporary.push(root);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const allowlistPath = path.join(root, 'scripts', 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', ...Object.keys(files)]);
  return { root, allowlistPath };
}

const run = ({ root, allowlistPath }) => spawnSync(process.execPath, [GUARD, '--root', root, '--allowlist', allowlistPath], { encoding: 'utf8' });

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
    const fixture = repository({ 'identity.txt': variants.join('\n') });
    const result = run(fixture);
    expect(result.status).toBe(1);
    for (const variant of variants) expect(`${result.stdout}${result.stderr}`).toContain(variant);
  });

  it('requires the exact allowed occurrence count', () => {
    const oldName = ['artifact', 'bin'].join('-');
    const fixture = repository({ 'history.txt': `${oldName}\n${oldName}\n` }, [
      { path: 'history.txt', value: oldName, count: 1, reason: 'fixture' },
    ]);
    expect(run(fixture).status).toBe(1);
    fs.writeFileSync(fixture.allowlistPath, JSON.stringify([
      { path: 'history.txt', value: oldName, count: 2, reason: 'fixture' },
    ]));
    expect(run(fixture).status).toBe(0);
  });

  it('does not inspect ignored or otherwise untracked files', () => {
    const oldName = ['artifact', 'bin'].join('-');
    const fixture = repository({ '.gitignore': '.env\n', 'tracked.txt': 'artifactbin\n' });
    fs.writeFileSync(path.join(fixture.root, '.env'), `${oldName}\n`);
    expect(run(fixture).status).toBe(0);
  });
});

/**
 * The token-only model (#94–#111) left no public mint and no token page: the CLI's OAuth approval is
 * the one thing that issues a credential. These strings named the surfaces that used to do it. Nothing
 * the product ships or documents may name them again — an agent that reads one sends a user to a 404.
 *
 * Tests, recorded transcripts and the gate that asserts the route is gone are exactly where these
 * strings SHOULD still appear, so the scan reads shipping sources only.
 */
const RETIRED_TOKEN_SURFACES = ['/tokens/new', '/api/tokens/anonymous', 'tokens/anonymous', '/settings/tokens'];
const NOT_SHIPPED = /(^|\/)(__tests__|test|tests|fixtures)(\/|$)|\.jsonl$|^scripts\/gate-/;

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
export function retiredSurfaces(files) {
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
      ['scripts/gate-simpler-start.mjs', "await fetch(`${B}/api/tokens/anonymous`, { method: 'POST' })"],
      ['evals/lib/run.ts', '// apiKeyEnv was renamed; see the guard'],
    ];
    expect(retiredSurfaces(elsewhere)).toEqual([]);
  });

  it('no shipping source or document names a retired token surface, or spells a variable like a key', () => {
    expect(retiredSurfaces(trackedText())).toEqual([]);
  });
});

/** THE README IS A FRONT DOOR (node S3): six sections in order, the two one-liners, no retired env name. */
const readme = () => read('README.md');
// The flat settings this product retired; the boot-time alias map is gone (no backward compatibility), so the
// list lives in the guards that keep the names from coming back (see services/app/lib/__tests__/retired-names.test.ts).
const retiredEnvNames = () => [
  'ADMIN_SECRET', 'AUTH_SECRET', 'PUBLIC_BASE_URL', 'PORT', 'RESEND_API_KEY', 'MIXPANEL_TOKEN',
  'TRUSTED_PROXY_HOPS', 'QUERY_TIMEOUT_MS', 'MAX_QUERY_ROWS', 'LOCAL_OBJECT_DIR',
];

describe('README.md', () => {
  it('is short and has exactly the six sections, in order', () => {
    expect(readme().split('\n').length).toBeLessThanOrEqual(90);
    expect(readme().split('\n').filter((l) => /^## /.test(l))).toEqual(['## Use it now', '## Self-host', '## Develop', '## Docs', '## License']);
    expect(readme().split('\n')[0]).toBe('# artifactbin');
  });
  it('carries the two one-liners, the hosted instance and the license', () => {
    expect(readme()).toContain('curl -fsSL https://artifactbin.dev/install.sh | bash');
    expect(readme()).toMatch(/git clone https:\/\/github\.com\/minusxai\/artifactbin[\s\S]*npm ci[\s\S]*npm run setup[\s\S]*npm run dev/);
    expect(readme()).toContain('npm run setup -- --yes --port <port>');
    expect(readme()).toContain('curl -fsS http://localhost:3030/health');
    expect(readme()).toContain('https://artifactbin.dev');
    expect(readme()).toContain('Apache-2.0');
    expect(readme()).toContain('ghcr.io/minusxai/artifactbin');
  });
});

describe('docs/', () => {
  it('holds the essays the README used to carry', () => {
    for (const f of ['editing.md', 'document-format.md', 'serving-and-security.md', 'ownership.md', 'operations.md']) {
      expect(fs.existsSync(path.join(ROOT, 'docs', f)), f).toBe(true);
      expect(read('docs', f).length, f).toBeGreaterThan(400);
      expect(readme(), f).toContain(`docs/${f}`);
    }
  });
  it('operations.md speaks only namespaced names', () => {
    for (const n of retiredEnvNames()) expect(read('docs', 'operations.md'), n).not.toMatch(new RegExp(`(^|[^A-Z_])${n}=`, 'm'));
  });
});

describe('license', () => {
  it('the root package.json declares Apache-2.0 like every service does', () => {
    expect(JSON.parse(read('package.json')).license).toBe('Apache-2.0');
  });
});

/** THE ONBOARDING DEFECTS (node S4): one port story, no stale text, a generator hint for every secret. */
describe('one port story', () => {
  it('docker-compose.yml publishes and mints links on the same port (3030 by default)', () => {
    const web = yaml.parse(read('docker-compose.yml')).services.web;
    expect(web.ports.some((p) => String(p).includes('${APP__PORT:-3030}:3000'))).toBe(true);
    expect(web.environment.APP__PUBLIC_BASE_URL).toBe('http://localhost:${APP__PORT:-3030}');
  });
  it('config.ts falls back to the same default port as dev-env.mjs (3030)', () => {
    const src = read('services', 'app', 'lib', 'config.ts');
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
    expect(read('services', 'app', 'lib', 'config.ts')).not.toMatch(/REFUSES TO START/);
  });
  it('.env.example gives a generator hint for ADMIN__SECRET too', () => {
    const lines = read('.env.example').split('\n');
    const i = lines.findIndex((l) => /^ADMIN__SECRET=/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(lines.slice(Math.max(0, i - 4), i).join('\n')).toMatch(/openssl rand -base64 32|npm run setup/);
  });
});
