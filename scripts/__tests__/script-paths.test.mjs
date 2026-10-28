/**
 * EVERY `scripts/` PATH A WORKFLOW OR A PACKAGE SCRIPT NAMES EXISTS IN THE TREE. Several callers never run
 * on a pull request (the CLI matrix, the nightly, dispatch-only release workflows), so a stale path there
 * fails a release or a nightly long after the change that broke it; this check fails the fast suite instead.
 *
 * THE EXTRACTION RULE, mechanically:
 *   - A reference is a token `[./]*(segment/)*scripts/<rest>` (letters, digits, `_ . / * -`), not preceded by
 *     a word character, `$`, `.`, `/` or `-` (so `$VAR/scripts/…`, `${{ … }}/scripts/…` and URLs are skipped),
 *     with trailing dots dropped. It names a file, or a directory when it ends at a `node_modules` segment or a
 *     glob segment (`*`, `?`, `{`, `[`), which are cut off: `scripts/ci/npm-acceptance/node_modules/x` names
 *     `scripts/ci/npm-acceptance`, `scripts/fixtures/page-speed/**` names `scripts/fixtures/page-speed`.
 *   - In `.github/workflows/*.yml` (parsed as YAML): a step's `run:` text resolves from the step's
 *     `working-directory` (else the job's or workflow's `defaults.run.working-directory`, else the root), moved
 *     by any `cd <dir>` earlier on the same line; `${{ … }}` expressions inside it (hashFiles) resolve from the
 *     root. Every other string value (`hashFiles` keys, cache `path:`, `sparse-checkout`, `paths:` filters) and
 *     every YAML comment resolves from the repository root, as GitHub resolves them from the workspace.
 *   - In every tracked package.json's `scripts`: from that package's directory, with the same `cd` rule.
 *   - Exists means a file in `git ls-files --cached --others --exclude-standard`, or a directory holding one,
 *     so a path present only in a local ignored install does not pass here and fail in CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');

const TOKEN = /(?<![\w$./-])((?:\.{1,2}\/)*(?:[\w.-]+\/)*scripts\/[\w./*-]+)/g;
const CD = /\bcd\s+([^\s;&|()]+)/g;
const EXPRESSION = /\$\{\{[^}]*\}\}/g;

/** The path a token names, relative to `base`; null when it climbs out of the repository. */
function resolveToken(base, token) {
  const segments = token.split('/');
  const cut = segments.findIndex((s) => s === 'node_modules' || /[*?{[]/.test(s));
  const kept = (cut === -1 ? segments : segments.slice(0, cut)).join('/').replace(/\/+$/, '');
  const resolved = path.posix.normalize(path.posix.join(base, kept));
  return resolved === '..' || resolved.startsWith('../') ? null : resolved;
}

/** Tokens in free text, each with the base it resolves from. */
function textTokens(text, base) {
  return [...text.matchAll(TOKEN)].map((m) => ({ token: m[1].replace(/\.+$/, ''), base }));
}

/** Tokens in shell text run from `dir`: a `cd` moves the rest of its line; `${{ }}` resolves from the root. */
function shellTokens(text, dir) {
  const out = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(EXPRESSION)) out.push(...textTokens(m[0], '.'));
    const plain = line.replace(EXPRESSION, (e) => ' '.repeat(e.length));
    const cds = [...plain.matchAll(CD)].map((m) => ({ at: m.index, to: m[1] }));
    for (const m of plain.matchAll(TOKEN)) {
      let base = dir;
      for (const cd of cds) if (cd.at < m.index) base = path.posix.normalize(path.posix.join(base, cd.to));
      out.push({ token: m[1].replace(/\.+$/, ''), base });
    }
  }
  return out;
}

/** Every `scripts/` token a workflow names, with the base each resolves from. */
function workflowTokens(text) {
  const doc = yaml.parseDocument(text);
  const out = [];
  const comment = (c) => { if (c) out.push(...textTokens(c, '.')); };
  comment(doc.commentBefore); comment(doc.comment);
  yaml.visit(doc, { Node(_, node) { comment(node.commentBefore); comment(node.comment); } });
  const walk = (node, runDir) => {
    if (typeof node === 'string') out.push(...textTokens(node, '.'));
    else if (Array.isArray(node)) for (const item of node) walk(item, runDir);
    else if (node && typeof node === 'object') {
      const dir = node['working-directory'] ?? node.defaults?.run?.['working-directory'] ?? runDir;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'run' && typeof value === 'string') out.push(...shellTokens(value, dir));
        else walk(value, dir);
      }
    }
  };
  walk(doc.toJS(), '.');
  return out;
}

/**
 * @param {{ files: string[], workflows: Array<{ file: string, text: string }>, packages: Array<{ file: string, scripts: Record<string, string> }> }} repo
 * @returns {{ checked: number, problems: string[] }} how many references were resolved, and one line per reference
 *   that names nothing in the tree
 */
function missingScriptPaths({ files, workflows, packages }) {
  const tracked = new Set(files);
  const dirs = new Set();
  for (const file of files) for (let d = path.posix.dirname(file); d !== '.'; d = path.posix.dirname(d)) dirs.add(d);
  const refs = [];
  for (const { file, text } of workflows) {
    const lines = text.split('\n');
    for (const { token, base } of workflowTokens(text)) refs.push({ where: `${file}:${lines.findIndex((l) => l.includes(token)) + 1}`, token, base });
  }
  for (const { file, scripts } of packages) {
    const dir = path.posix.dirname(file);
    for (const [name, body] of Object.entries(scripts)) for (const { token, base } of shellTokens(body, dir)) refs.push({ where: `${file} scripts.${name}`, token, base });
  }
  const problems = [];
  for (const { where, token, base } of refs) {
    const resolved = resolveToken(base, token);
    if (resolved === null) problems.push(`${where} names ${token}, which climbs out of the repository from ${base}`);
    else if (!tracked.has(resolved) && !dirs.has(resolved)) problems.push(`${where} names ${token} (${resolved}), which is not in the tree`);
  }
  return { checked: refs.length, problems: [...new Set(problems)] };
}

function repoOnDisk() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const onDisk = files.filter((file) => { try { read(file); return true; } catch { return false; } });
  return {
    files: onDisk,
    workflows: onDisk.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).map((file) => ({ file, text: read(file) })),
    packages: onDisk.filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes('node_modules')).map((file) => ({ file, scripts: JSON.parse(read(file)).scripts ?? {} })),
  };
}

describe('the extraction rule', () => {
  const files = [
    'scripts/ci/ci.mjs', 'scripts/lib/ci-elapsed.mjs', 'scripts/ci/npm-acceptance/package-lock.json', 'scripts/fixtures/page-speed/a.html',
    'scripts/build/build-islands.mjs', 'services/app/scripts/build-server-reader.mjs', 'services/cli/scripts/test-installed-npm.mjs',
    'services/cli/scripts/generate-teaching.mjs',
  ];
  const workflow = [
    'on:',
    '  push:',
    '    paths:',
    "      - 'scripts/fixtures/page-speed/**'",
    'jobs:',
    '  a:',
    '    steps:',
    '      # the elapsed summary lives in scripts/lib/ci-elapsed.mjs.',
    '      - run: (cd services/app && node scripts/build-server-reader.mjs && node ../../scripts/build/build-islands.mjs)',
    '      - run: node scripts/test-installed-npm.mjs ${{ hashFiles(\'scripts/ci/npm-acceptance/package-lock.json\') }}',
    '        working-directory: services/cli',
    '      - run: npm ci --prefix scripts/ci/npm-acceptance && node "$RUNNER_TEMP/scripts/elsewhere.mjs"',
    '      - uses: actions/cache@x',
    '        with:',
    '          path: scripts/ci/npm-acceptance/node_modules',
    '      - run: node scripts/ci/ci.mjs',
    '',
  ].join('\n');
  const packages = [{ file: 'services/app/package.json', scripts: { teach: 'node ../cli/scripts/generate-teaching.mjs', islands: 'node ../../scripts/build/build-islands.mjs' } }];

  it('resolves run text from its working directory and cd, everything else from the root, packages from their directory', () => {
    expect(missingScriptPaths({ files, workflows: [{ file: 'w.yml', text: workflow }], packages })).toEqual({ checked: 11, problems: [] });
  });

  it('names every stale reference, wherever it sits', () => {
    const stale = workflow.replace('ci-elapsed', 'ci-gone').replace('node scripts/ci/ci.mjs', 'node scripts/ci/moved.mjs').replace("'scripts/fixtures/page-speed/**'", "'scripts/fixtures/old-speed/**'");
    const stalePackages = [{ file: 'services/app/package.json', scripts: { teach: 'node scripts/generate-teaching.mjs', up: 'node ../../../scripts/x.mjs' } }];
    expect(missingScriptPaths({ files, workflows: [{ file: 'w.yml', text: stale }], packages: stalePackages }).problems).toEqual([
      'w.yml:8 names scripts/lib/ci-gone.mjs (scripts/lib/ci-gone.mjs), which is not in the tree',
      'w.yml:4 names scripts/fixtures/old-speed/** (scripts/fixtures/old-speed), which is not in the tree',
      'w.yml:16 names scripts/ci/moved.mjs (scripts/ci/moved.mjs), which is not in the tree',
      'services/app/package.json scripts.teach names scripts/generate-teaching.mjs (services/app/scripts/generate-teaching.mjs), which is not in the tree',
      'services/app/package.json scripts.up names ../../../scripts/x.mjs, which climbs out of the repository from services/app',
    ]);
  });
});

describe('workflows and package scripts', () => {
  it('name only scripts/ paths that exist in the tree', () => {
    const { checked, problems } = missingScriptPaths(repoOnDisk());
    expect(problems.join('\n')).toBe('');
    expect(checked).toBeGreaterThanOrEqual(100);
  });
});
