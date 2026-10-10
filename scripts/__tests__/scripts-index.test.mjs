/**
 * THE SCRIPTS INDEX (scripts/README.md) has one row per entry point under scripts/, and no other row.
 *
 * WHAT AN ENTRY POINT IS, mechanically: a code file (.mjs .cjs .js .ts .mts .ps1 .sh, not a .d.mts)
 * under scripts/ (tracked, or untracked and not ignored), outside __tests__/ and fixtures/, that
 *   (a) a command runs: a tracked package.json script, or a workflow line that is not a comment, names
 *       its path (a `- 'scripts/…'` path-filter item triggers a workflow, it runs nothing), or
 *   (b) starts with a shebang, or
 *   (c) no other non-test file imports (`from`, `import`, `import()`, `require()`, `tsImport()` with a
 *       relative specifier): a program, not a library.
 * Every other file under scripts/ is a library an entry point imports, and gets no row. The journey
 * gates (scripts/gates/gate-*.mjs) are entry points by (c) and have rows here as well as their
 * gates.manifest.mjs rows.
 *
 * A row is a table line whose first cell is one backticked `scripts/…` path. The check is a bijection,
 * like the gate manifest's: a new program without a row fails, and a row naming a file that is gone (or
 * that became a library) fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const INDEX = 'scripts/README.md';

const CODE = /\.(mjs|cjs|js|ts|tsx|mts|cts|jsx)$/;
const SCRIPT_FILE = /^scripts\/(?!__tests__\/|fixtures\/).*\.(mjs|cjs|js|ts|mts|ps1|sh)$/;
const IS_TEST = /(^|\/)(__tests__|test)\/|\.test\.[cm]?[jt]sx?$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\btsImport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
const RUN = /(?:^|[\s'"=(])((?:\.\.\/)*scripts\/[\w./-]+\.(?:mjs|cjs|js|ts|mts|ps1|sh))\b/g;

/**
 * @param {{ files: string[], read: (file: string) => string, commands: Array<{ dir: string, text: string }> }} repo
 *   `files` are tracked paths; `commands` are package.json script bodies and workflow text, each with the
 *   directory its relative paths resolve from.
 * @returns {string[]} the entry points, sorted
 */
function entryPoints({ files, read, commands }) {
  const candidates = new Set(files.filter((file) => SCRIPT_FILE.test(file) && !file.endsWith('.d.mts')));
  const imported = new Set();
  for (const file of files) {
    if (!CODE.test(file) || IS_TEST.test(file)) continue;
    for (const match of read(file).matchAll(SPECIFIER)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      const hit = [target, `${target}.mjs`, `${target}.ts`, `${target}.js`, target.replace(/\.js$/, '.ts')].find((c) => candidates.has(c));
      if (hit && hit !== file) imported.add(hit);
    }
  }
  const run = new Set();
  for (const { dir, text } of commands) {
    const lines = text.split('\n').filter((line) => !/^\s*#/.test(line) && !/^\s*-\s*['"]?scripts\//.test(line));
    for (const match of lines.join('\n').matchAll(RUN)) {
      const resolved = path.posix.normalize(path.posix.join(dir, match[1]));
      if (candidates.has(resolved)) run.add(resolved);
    }
  }
  return [...candidates].filter((file) => run.has(file) || read(file).startsWith('#!') || !imported.has(file)).sort();
}

/** The backticked `scripts/…` path in the first cell of every table row. */
function indexRows(markdown) {
  return markdown.split('\n').map((line) => /^\|\s*`(scripts\/[^`]+)`\s*\|/.exec(line)?.[1]).filter(Boolean);
}

/** Every problem with the index, one per line; empty when rows and entry points are one set. */
function indexProblems(entries, rows) {
  const want = new Set(entries);
  const seen = new Set();
  const problems = [];
  for (const row of rows) {
    if (seen.has(row)) problems.push(`${row} has two rows`);
    seen.add(row);
    if (!want.has(row)) problems.push(`${row} has a row but is not an entry point (missing, or now only a library)`);
  }
  for (const entry of entries) if (!seen.has(entry)) problems.push(`${entry} is an entry point with no row in ${INDEX}`);
  return problems;
}

function repoOnDisk() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  const read = (file) => { try { return readFileSync(path.join(ROOT, file), 'utf8'); } catch { return ''; } };
  const commands = [];
  for (const file of files.filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes('node_modules'))) {
    const scripts = JSON.parse(read(file) || '{}').scripts ?? {};
    commands.push({ dir: path.posix.dirname(file), text: Object.values(scripts).join('\n') });
  }
  for (const file of files.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) commands.push({ dir: '.', text: read(file) });
  return { files, read, commands };
}

describe('the entry-point rule', () => {
  const sources = {
    'scripts/new-tool.mjs': "import { helper } from './lib/helper.mjs';\nhelper();\n",
    'scripts/lib/helper.mjs': 'export const helper = () => {};\n',
    'scripts/lib/run-by-ci.mjs': 'export const x = 1;\n',
    'scripts/lib/named-in-a-comment.mjs': 'export const y = 1;\n',
    'scripts/lib/tested-only.mjs': 'export const z = 1;\n',
    'scripts/lib/shebang.mjs': '#!/usr/bin/env node\nexport const w = 1;\n',
    'scripts/__tests__/tested.test.mjs': "import { z } from '../lib/tested-only.mjs';\n",
    'scripts/fixtures/data.mjs': 'export default 1;\n',
    'scripts/user.mjs': "import './lib/run-by-ci.mjs';\nimport './lib/named-in-a-comment.mjs';\nimport './lib/shebang.mjs';\n",
  };
  const repo = {
    files: Object.keys(sources),
    read: (file) => sources[file] ?? '',
    commands: [{ dir: '.', text: "jobs:\n  # scripts/lib/named-in-a-comment.mjs\n  on:\n    paths:\n      - 'scripts/lib/named-in-a-comment.mjs'\n  run: node scripts/lib/run-by-ci.mjs\n" }],
  };

  it('counts programs, run libraries and shebangs; not imported libraries, comments, path filters, tests or fixtures', () => {
    expect(entryPoints(repo)).toEqual(['scripts/lib/run-by-ci.mjs', 'scripts/lib/shebang.mjs', 'scripts/lib/tested-only.mjs', 'scripts/new-tool.mjs', 'scripts/user.mjs']);
  });

  it('names a new program without a row, and a row whose file is gone', () => {
    const rows = indexRows('| File | Purpose |\n|---|---|\n| `scripts/user.mjs` | x |\n| `scripts/removed.mjs` | y |\n');
    expect(rows).toEqual(['scripts/user.mjs', 'scripts/removed.mjs']);
    const problems = indexProblems(['scripts/new-tool.mjs', 'scripts/user.mjs'], rows);
    expect(problems).toEqual([
      'scripts/removed.mjs has a row but is not an entry point (missing, or now only a library)',
      `scripts/new-tool.mjs is an entry point with no row in ${INDEX}`,
    ]);
    expect(indexProblems(['scripts/user.mjs'], ['scripts/user.mjs', 'scripts/user.mjs'])).toEqual(['scripts/user.mjs has two rows']);
  });
});

describe(INDEX, () => {
  it('has one row for every entry point under scripts/, and no other row', () => {
    const repo = repoOnDisk();
    const entries = entryPoints(repo);
    expect(entries.length).toBeGreaterThanOrEqual(50);
    expect(indexProblems(entries, indexRows(repo.read(INDEX))).join('\n')).toBe('');
  });
});
